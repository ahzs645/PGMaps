import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RestaurantMap } from './components/RestaurantMap'
import { Sidebar } from './components/Sidebar'
import { InspectionPanel } from './components/InspectionPanel'
import { Timeline } from '@/components/ui/timeline'
import { LegendItem, MapLegendPanel, MapSizeLegend } from '@/components/ui/map-panels'
import { RouletteModal } from './components/roulette'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { useRestaurantData } from './hooks/useRestaurantData'
import { createEmptyViolationRiskSummary, summarizeViolationRisk } from './risk'
import type { RestaurantWithStats, HazardRating, VisualizationMode, ViolationTimelineMode } from './types'

type ViolationBucket = 'zero' | 'low' | 'medium' | 'high'

const VIOLATION_BUCKETS: Array<{
  key: ViolationBucket
  label: string
  color: string
  matches: (count: number) => boolean
}> = [
  { key: 'zero', label: '0 violations', color: '#22c55e', matches: (count) => count === 0 },
  { key: 'low', label: '1-2 violations', color: '#eab308', matches: (count) => count >= 1 && count <= 2 },
  { key: 'medium', label: '3-5 violations', color: '#f97316', matches: (count) => count >= 3 && count <= 5 },
  { key: 'high', label: '6+ violations', color: '#ef4444', matches: (count) => count >= 6 },
]

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

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function FoodMap() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { restaurants, loading, error, stats } = useRestaurantData()

  // Filter state
  const [selectedHazardRatings, setSelectedHazardRatings] = useState<HazardRating[]>(['Low', 'Moderate', 'Unknown'])
  const [selectedViolationBuckets, setSelectedViolationBuckets] = useState<ViolationBucket[]>(
    VIOLATION_BUCKETS.map((bucket) => bucket.key)
  )
  const [selectedFacilityTypes, setSelectedFacilityTypes] = useState<string[]>([
    'Restaurant', 'Food Truck', 'Camp', 'Catering', 'Concession', 'Stand',
    'Bakery', 'Coffee Shop', 'Bar/Pub', 'Brewery/Winery', 'Deli',
    'Community Kitchen', 'Social Services', 'Gas Station', 'Hotel',
    'Recreation', 'Farm', 'Institutional Kitchen', 'Store', 'Other', 'Unknown'
  ])
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantWithStats | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showInspectionPanel, setShowInspectionPanel] = useState(false)
  const [showRoulette, setShowRoulette] = useState(false)
  const [legendCollapsed, setLegendCollapsed] = useState(false)

  // Visualization mode: 'hazard' or 'violations'
  const [visualizationMode, setVisualizationMode] = useState<VisualizationMode>(
    () => (searchParams.get('mode') as VisualizationMode) || 'violations'
  )

  // Timeline toggle
  const [showTimeline, setShowTimeline] = useState(false)

  // Timeline filter - default to past year
  const [timelineMonths, setTimelineMonths] = useState(() => {
    const fromUrl = searchParams.get('months')
    return fromUrl ? parseInt(fromUrl, 10) || 12 : 12
  })
  const [violationTimelineMode, setViolationTimelineMode] = useState<ViolationTimelineMode>(
    () => (searchParams.get('violationTimeline') as ViolationTimelineMode) || 'period'
  )
  const [pendingRestaurantName, setPendingRestaurantName] = useState(() => searchParams.get('restaurant') || '')

  const now = new Date()
  const [timelineDate, setTimelineDate] = useState(startOfMonth(now))

  // Sync key filters to URL for shareable links
  useEffect(() => {
    const params = new URLSearchParams()
    if (searchQuery) params.set('q', searchQuery)
    if (visualizationMode !== 'violations') params.set('mode', visualizationMode)
    if (timelineMonths !== 12) params.set('months', String(timelineMonths))
    if (violationTimelineMode !== 'period') params.set('violationTimeline', violationTimelineMode)
    if (selectedRestaurant) params.set('restaurant', selectedRestaurant.name)
    else if (pendingRestaurantName) params.set('restaurant', pendingRestaurantName)
    setSearchParams(params, { replace: true })
  }, [pendingRestaurantName, searchQuery, selectedRestaurant, visualizationMode, timelineMonths, violationTimelineMode, setSearchParams])

  const violationDateRange = useMemo(() => {
    const end = endOfMonth(timelineDate)

    if (violationTimelineMode === 'cumulative' || timelineMonths === 0) {
      return { start: null as Date | null, end }
    }

    const start = startOfMonth(timelineDate)
    start.setMonth(start.getMonth() - timelineMonths + 1)
    return { start, end }
  }, [timelineDate, timelineMonths, violationTimelineMode])

  const violationTimelineLabel = useMemo(() => {
    if (violationTimelineMode === 'cumulative') {
      return `Through ${formatMonthYear(timelineDate)}`
    }
    if (timelineMonths === 0) {
      return `All time through ${formatMonthYear(timelineDate)}`
    }
    const start = violationDateRange.start
    return start
      ? `${formatMonthYear(start)}-${formatMonthYear(violationDateRange.end)}`
      : `Through ${formatMonthYear(timelineDate)}`
  }, [timelineDate, timelineMonths, violationDateRange, violationTimelineMode])

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

      const filteredInspections = inspections
        .filter(insp => {
          const date = parseInspectionDate(insp.date || insp.inspection_date)
          if (!date) return false
          const matchesStart = !violationDateRange.start || date >= violationDateRange.start
          return matchesStart && date <= violationDateRange.end
        })
        .sort((a, b) => {
          const dateA = parseInspectionDate(a.date || a.inspection_date)?.getTime() || 0
          const dateB = parseInspectionDate(b.date || b.inspection_date)?.getTime() || 0
          return dateB - dateA
        })

      // Calculate violation stats
      let totalViolations = 0
      let criticalViolations = 0
      let nonCriticalViolations = 0

      filteredInspections.forEach(insp => {
        totalViolations += (insp.violations?.length || 0)
        criticalViolations += (insp.critical_violations_count || 0)
        nonCriticalViolations += (insp.non_critical_violations_count || 0)
      })

      const risk = summarizeViolationRisk(filteredInspections)

      const result: RestaurantWithStats = {
        ...r,
        filteredInspections,
        hazardRatingAtDate: 'Unknown' as HazardRating,
        violationStats: {
          total: totalViolations,
          critical: criticalViolations,
          nonCritical: nonCriticalViolations,
          inspectionCount: filteredInspections.length,
          risk: totalViolations > 0 ? risk : createEmptyViolationRiskSummary()
        }
      }

      // Get hazard rating at the timeline date (for hazard mode)
      result.hazardRatingAtDate = getHazardRatingAtDate(result, timelineDate)

      return result
    })
  }, [restaurants, violationDateRange, timelineDate, getHazardRatingAtDate])

  const filteredRestaurants = useMemo(() => {
    return restaurantsWithStats.filter(r => {
      // In hazard mode, filter by the rating at the selected date
      const ratingToCheck = visualizationMode === 'hazard'
        ? r.hazardRatingAtDate
        : (r.current_hazard_rating || r.hazard_rating || 'Unknown') as HazardRating

      const matchesHazard = selectedHazardRatings.includes(ratingToCheck)
      const violationCount = r.violationStats?.total || 0
      const matchesViolationBucket = visualizationMode !== 'violations' || VIOLATION_BUCKETS.some((bucket) => (
        selectedViolationBuckets.includes(bucket.key) && bucket.matches(violationCount)
      ))
      const matchesFacility = selectedFacilityTypes.includes(r.establishment_type || r.facility_type || 'Unknown')
      const matchesSearch = !searchQuery ||
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.address.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesHazard && matchesViolationBucket && matchesFacility && matchesSearch
    })
  }, [restaurantsWithStats, visualizationMode, selectedHazardRatings, selectedViolationBuckets, selectedFacilityTypes, searchQuery])

  const geocodedRestaurants = useMemo(() => {
    return filteredRestaurants.filter(r => r.latitude && r.longitude)
  }, [filteredRestaurants])

  useEffect(() => {
    if (!pendingRestaurantName || selectedRestaurant) return
    const restaurant = restaurantsWithStats.find((item) => item.name === pendingRestaurantName)
    if (restaurant) {
      setSelectedRestaurant(restaurant)
      setPendingRestaurantName('')
    }
  }, [pendingRestaurantName, restaurantsWithStats, selectedRestaurant])

  useEffect(() => {
    if (!selectedRestaurant) return
    const updatedRestaurant = restaurantsWithStats.find((item) => item.details_url === selectedRestaurant.details_url)
    if (updatedRestaurant && updatedRestaurant !== selectedRestaurant) {
      setSelectedRestaurant(updatedRestaurant)
    }
  }, [restaurantsWithStats, selectedRestaurant])

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

  const violationBucketRows = useMemo(() => {
    return VIOLATION_BUCKETS.map((bucket) => ({
      ...bucket,
      count: restaurantsWithStats.filter((restaurant) => bucket.matches(restaurant.violationStats?.total || 0)).length,
      active: selectedViolationBuckets.includes(bucket.key),
    }))
  }, [restaurantsWithStats, selectedViolationBuckets])
  const showLegend = visualizationMode === 'violations'
    ? selectedViolationBuckets.length > 0
    : selectedHazardRatings.length > 0

  const toggleHazardRating = useCallback((hazard: HazardRating) => {
    setSelectedHazardRatings((current) => (
      current.includes(hazard)
        ? current.filter((item) => item !== hazard)
        : [...current, hazard]
    ))
  }, [])

  const toggleViolationBucket = useCallback((bucket: ViolationBucket) => {
    setSelectedViolationBuckets((current) => (
      current.includes(bucket)
        ? current.filter((item) => item !== bucket)
        : [...current, bucket]
    ))
  }, [])

  // Handlers
  const handleRestaurantClick = useCallback((restaurant: RestaurantWithStats) => {
    setSelectedRestaurant(restaurant)
  }, [])

  const handleMapRestaurantClick = useCallback((restaurant: RestaurantWithStats) => {
    setSelectedRestaurant(restaurant)
    setShowSidebar(true)
  }, [])

  const clearSelection = useCallback(() => {
    setPendingRestaurantName('')
    setSelectedRestaurant(null)
    setShowInspectionPanel(false)
  }, [])

  const openInspectionPanel = useCallback(() => {
    setShowInspectionPanel(true)
  }, [])

  const handleMapViewInspections = useCallback((restaurant: RestaurantWithStats) => {
    setSelectedRestaurant(restaurant)
    setShowSidebar(true)
    setShowInspectionPanel(true)
  }, [])

  const handleRouletteSelectOnMap = useCallback((restaurant: RestaurantWithStats) => {
    setSelectedRestaurant(restaurant)
    setShowRoulette(false)
    setShowSidebar(true)
  }, [])

  return (
    <>
      <MapSectionLayout
        showDesktopSidebar={showSidebar}
        onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
        mobilePeek={(
          <div className="min-w-0 text-left">
            <div className="truncate text-xs font-semibold text-foreground">
              Food Safety | {geocodedRestaurants.length.toLocaleString()} on map
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {selectedRestaurant?.name || `${visualizationMode} | ${timelineMonths || 'all'} months`}
            </div>
          </div>
        )}
        sidebar={(
          <Sidebar
            className="h-full w-full border-0 shadow-none md:w-[350px] md:border-r md:shadow-xl"
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
            violationTimelineMode={violationTimelineMode}
            violationTimelineLabel={violationTimelineLabel}
            visualizationMode={visualizationMode}
            onSearchQueryChange={setSearchQuery}
            onHazardRatingsChange={setSelectedHazardRatings}
            onFacilityTypesChange={setSelectedFacilityTypes}
            onTimelineMonthsChange={setTimelineMonths}
            onViolationTimelineModeChange={setViolationTimelineMode}
            onVisualizationModeChange={setVisualizationMode}
            onRestaurantClick={handleRestaurantClick}
            onClearSelection={clearSelection}
            onOpenInspectionPanel={openInspectionPanel}
            showTimeline={showTimeline}
            onToggleTimeline={() => setShowTimeline(!showTimeline)}
            onOpenRoulette={() => setShowRoulette(true)}
          />
        )}
      >
        <div className="relative h-full">
        <RestaurantMap
          restaurants={geocodedRestaurants}
          selectedRestaurant={selectedRestaurant}
          visualizationMode={visualizationMode}
          loading={loading}
          onRestaurantClick={handleMapRestaurantClick}
          onViewInspections={handleMapViewInspections}
          onClearSelection={clearSelection}
        />

        {/* Timeline */}
        {showTimeline && (
          <Timeline
            startDate={inspectionDateRange.start}
            endDate={inspectionDateRange.end}
            currentDate={timelineDate}
            onDateChange={setTimelineDate}
            onClose={() => setShowTimeline(false)}
          />
        )}

        {showLegend && (
          <MapLegendPanel
            className="max-w-[200px]"
            title={visualizationMode === 'violations' ? 'Violations' : 'Hazard Rating'}
            collapsible
            collapsed={legendCollapsed}
            onCollapsedChange={setLegendCollapsed}
            elevated={showTimeline}
            contentClassName="space-y-1 text-xs text-muted-foreground"
            actions={legendCollapsed ? null : visualizationMode === 'violations' ? (
              <span className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedViolationBuckets(VIOLATION_BUCKETS.map((bucket) => bucket.key))}
                  className="font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedViolationBuckets([])}
                  className="font-medium text-muted-foreground hover:text-foreground"
                >
                  None
                </button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedHazardRatings(['Low', 'Moderate', 'Unknown'])}
                  className="font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedHazardRatings([])}
                  className="font-medium text-muted-foreground hover:text-foreground"
                >
                  None
                </button>
              </span>
            )}
          >
            {/* Violations legend */}
            {visualizationMode === 'violations' && (
              <div className="space-y-1">
                <div className="pb-0.5 text-xs leading-snug text-muted-foreground">{violationTimelineLabel}</div>
                {violationBucketRows.map((bucket) => (
                  <LegendItem
                    key={bucket.key}
                    color={bucket.color}
                    label={bucket.label}
                    value={bucket.count.toLocaleString()}
                    active={bucket.active}
                    onClick={() => toggleViolationBucket(bucket.key)}
                  />
                ))}
              </div>
            )}

            {/* Hazard rating legend with counts */}
            {visualizationMode === 'hazard' && (
              <div className="space-y-1">
                <LegendItem
                  color="#22c55e"
                  label="Low"
                  value={hazardStatsAtDate.Low}
                  active={selectedHazardRatings.includes('Low')}
                  onClick={() => toggleHazardRating('Low')}
                />
                <LegendItem
                  color="#f59e0b"
                  label="Moderate"
                  value={hazardStatsAtDate.Moderate}
                  active={selectedHazardRatings.includes('Moderate')}
                  onClick={() => toggleHazardRating('Moderate')}
                />
                <LegendItem
                  color="#6b7280"
                  label="Unknown"
                  value={hazardStatsAtDate.Unknown}
                  active={selectedHazardRatings.includes('Unknown')}
                  onClick={() => toggleHazardRating('Unknown')}
                />
              </div>
            )}

            {visualizationMode === 'violations' && (
              <div className="mt-2 border-t border-border pt-2">
                <MapSizeLegend minLabel="Size" maxLabel="count" sizes={[10, 14, 18]} />
              </div>
            )}
          </MapLegendPanel>
        )}
        </div>
      </MapSectionLayout>

      {/* Inspection Detail Panel */}
      {showInspectionPanel && selectedRestaurant && (
        <InspectionPanel
          restaurant={selectedRestaurant}
          periodLabel={violationTimelineLabel}
          useFilteredInspections={visualizationMode === 'violations'}
          onClose={() => setShowInspectionPanel(false)}
        />
      )}

      {/* Restaurant Roulette Modal */}
      {showRoulette && (
        <RouletteModal
          restaurants={restaurants}
          onClose={() => setShowRoulette(false)}
          onSelectOnMap={handleRouletteSelectOnMap}
        />
      )}
    </>
  )
}
