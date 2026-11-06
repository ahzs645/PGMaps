import { useState, useMemo, useCallback, useRef } from 'react'
import { Dices } from 'lucide-react'
import { RestaurantMap } from './components/RestaurantMap'
import { Sidebar } from './components/Sidebar'
import { InspectionPanel } from './components/InspectionPanel'
import { Timeline } from '@/components/ui/timeline'
import { LegendItem, MapLegendPanel, MapSizeLegend } from '@/components/ui/map-panels'
import { SelectAllActions } from '@/components/ui/text-button'
import { DEFAULT_LOCALE } from '@/lib/format'
import { RouletteModal } from './components/roulette'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MapTableBridge, defineTableSource, useMapTable } from '@/components/map/useMapTable'
import { MapScaleBar } from '@/components/ui/map'
import { useRestaurantData } from './hooks/useRestaurantData'
import { FACILITY_TYPE_OPTIONS, HAZARD_RATING_OPTIONS, useFoodMapFilters } from './hooks/useFoodMapFilters'
import { stringCodec, useUrlState } from '@/hooks/useUrlState'
import { isMobileViewport } from '@/hooks/useIsMobile'
import { toggleArrayItem, useToggleArray } from '@/hooks/useToggleArray'
import { createEmptyViolationRiskSummary, summarizeViolationRisk } from './risk'
import { getHazardRating } from './hazard'
import {
  criticalViolationsByMonth,
  encodeTimelineMonth,
  endOfMonth,
  findRatingChanges,
  hazardRatingAt,
  inspectionDate,
  inspectionMonthRange,
  parseInspectionDate,
  ratingChangesByMonth,
  resolveTimelineMonth,
  sameMonth,
  startOfMonth,
  VIOLATION_RATE_SHIFT,
  type RatingChange,
} from './inspectionTimeline'
import { formatFullAddress } from './address'
import { foodTableColumns } from './foodTable'
import { useFoodMapWebMCP } from './foodWebMCP'
import { useCrimeData } from '@/maps/pgdata/hooks/useCrimeData'
import {
  FOOD_VIOLATION_BUCKETS,
  getViolationBucket,
  VIOLATION_BUCKET_STYLES,
  type FoodViolationBucket,
} from './violationBuckets'
import type { Restaurant, RestaurantWithStats, HazardRating } from './types'

type ViolationBucket = FoodViolationBucket

// Codec for the selected restaurant's name in the URL (absent = no selection)
const restaurantNameCodec = stringCodec('')
// The timeline month ("2024-03"); absent means the latest month with inspections.
const timelineDateCodec = stringCodec('')

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

const WINDOW_OPTIONS = [
  { value: 3, label: '3 mo' },
  { value: 6, label: '6 mo' },
  { value: 12, label: '1 yr' },
  { value: 24, label: '2 yr' },
  { value: -1, label: 'All' },
]

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`
}

export default function FoodMap() {
  const { restaurants, loading, error, stats } = useRestaurantData()
  const { incidents: crimeIncidents, loading: crimeLoading, error: crimeError } = useCrimeData()

  // Filter state, persisted to URL search params for shareable links
  const { filters, actions } = useFoodMapFilters()
  const {
    hazardRatings: selectedHazardRatings,
    facilityTypes: selectedFacilityTypes,
    searchQuery,
    visualizationMode,
    timelineMonths,
    sortOrder,
  } = filters

  const [selectedViolationBuckets, setSelectedViolationBuckets] = useState<ViolationBucket[]>([
    ...FOOD_VIOLATION_BUCKETS,
  ])
  const [restaurantName, setRestaurantName] = useUrlState('restaurant', restaurantNameCodec)
  const selectedRowTrigger = useRef<HTMLButtonElement | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showInspectionPanel, setShowInspectionPanel] = useState(false)
  const [showRoulette, setShowRoulette] = useState(false)
  // Phones start with the legend folded: expanded, it covers a quarter of the
  // map right above the sheet. Same rule as MapLegendPanel's defaultCollapsed="mobile".
  const [legendCollapsed, setLegendCollapsed] = useState(isMobileViewport)

  // The month is in the URL so a shared link lands on it, and such a link
  // opens with the timeline up to show where it landed.
  const [timelineParam, setTimelineParam] = useUrlState('date', timelineDateCodec)
  const [showTimeline, setShowTimeline] = useState(timelineParam !== '')

  // The track covers the inspection record, which stops at the last scrape.
  const inspectionDateRange = useMemo(() => {
    const thisMonth = startOfMonth(new Date())
    return inspectionMonthRange(restaurants) ?? { start: thisMonth, end: thisMonth }
  }, [restaurants])

  const timelineDate = useMemo(
    () => resolveTimelineMonth(timelineParam, inspectionDateRange),
    [timelineParam, inspectionDateRange],
  )

  const setTimelineDate = useCallback(
    (date: Date) => setTimelineParam(sameMonth(date, inspectionDateRange.end) ? '' : encodeTimelineMonth(date)),
    [inspectionDateRange.end, setTimelineParam],
  )

  const violationDateRange = useMemo(() => {
    const end = endOfMonth(timelineDate)

    if (timelineMonths === 0) return { start: null as Date | null, end }

    const start = startOfMonth(timelineDate)
    start.setMonth(start.getMonth() - timelineMonths + 1)
    return { start, end }
  }, [timelineDate, timelineMonths])

  const violationTimelineLabel = useMemo(() => {
    const start = violationDateRange.start
    if (!start) return `Through ${formatMonthYear(timelineDate)}`
    // Early windows stop at the first inspection, as the timeline's highlight does.
    const shownStart = start < inspectionDateRange.start ? inspectionDateRange.start : start
    return sameMonth(shownStart, timelineDate)
      ? formatMonthYear(timelineDate)
      : `${formatMonthYear(shownStart)} – ${formatMonthYear(violationDateRange.end)}`
  }, [timelineDate, violationDateRange, inspectionDateRange.start])

  // Compute violation stats for each restaurant within the timeline
  const restaurantsWithStats = useMemo<RestaurantWithStats[]>(() => {
    return restaurants.map((r) => {
      const inspections = r.inspections || []

      const filteredInspections = inspections
        .filter((insp) => {
          const date = inspectionDate(insp)
          if (!date) return false
          const matchesStart = !violationDateRange.start || date >= violationDateRange.start
          return matchesStart && date <= violationDateRange.end
        })
        .sort((a, b) => {
          return (inspectionDate(b)?.getTime() || 0) - (inspectionDate(a)?.getTime() || 0)
        })

      // Calculate violation stats
      let totalViolations = 0
      let criticalViolations = 0
      let nonCriticalViolations = 0

      filteredInspections.forEach((insp) => {
        totalViolations += insp.violations?.length || 0
        criticalViolations += insp.critical_violations_count || 0
        nonCriticalViolations += insp.non_critical_violations_count || 0
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
          risk: totalViolations > 0 ? risk : createEmptyViolationRiskSummary(),
        },
      }

      // The month's own inspections count, as they do for the violation window.
      result.hazardRatingAtDate = hazardRatingAt(r, violationDateRange.end)

      return result
    })
  }, [restaurants, violationDateRange])

  // The filters that don't depend on the timeline's position, so the bars and
  // totals follow them without shifting while the timeline scrubs. Hazard chips
  // read the scrubbed rating in hazard mode, so they stay out of it there.
  const matchesScope = useCallback(
    (r: Restaurant) => {
      const matchesHazard = visualizationMode === 'hazard' || selectedHazardRatings.includes(getHazardRating(r))
      const matchesFacility = selectedFacilityTypes.includes(r.establishment_type || r.facility_type || 'Unknown')
      const query = searchQuery.toLowerCase()
      const matchesSearch = !query || r.name.toLowerCase().includes(query) || r.address.toLowerCase().includes(query)
      return matchesHazard && matchesFacility && matchesSearch
    },
    [visualizationMode, selectedHazardRatings, selectedFacilityTypes, searchQuery],
  )

  const scopedRestaurants = useMemo(() => restaurants.filter(matchesScope), [restaurants, matchesScope])
  const scopedWithStats = useMemo(() => restaurantsWithStats.filter(matchesScope), [restaurantsWithStats, matchesScope])

  const filteredRestaurants = useMemo(() => {
    return scopedWithStats.filter((r) => {
      if (visualizationMode === 'hazard') return selectedHazardRatings.includes(r.hazardRatingAtDate)
      return selectedViolationBuckets.includes(getViolationBucket(r.violationStats))
    })
  }, [scopedWithStats, visualizationMode, selectedHazardRatings, selectedViolationBuckets])

  const ratingChanges = useMemo(() => findRatingChanges(scopedRestaurants), [scopedRestaurants])
  const monthRatingChanges = useMemo(
    () => ratingChanges.filter((change) => sameMonth(change.date, timelineDate)),
    [ratingChanges, timelineDate],
  )

  const timelineBars = useMemo(
    () =>
      visualizationMode === 'violations'
        ? criticalViolationsByMonth(scopedRestaurants)
        : ratingChangesByMonth(ratingChanges),
    [visualizationMode, scopedRestaurants, ratingChanges],
  )

  const geocodedRestaurants = useMemo(() => {
    return filteredRestaurants.filter((r) => r.latitude && r.longitude)
  }, [filteredRestaurants])

  // Only the sidebar list is ordered; the map and WebMCP read filteredRestaurants.
  const sortedRestaurants = useMemo(() => {
    if (sortOrder === 'name') return filteredRestaurants
    const latestTime = (r: RestaurantWithStats) =>
      Math.max(0, ...(r.inspections || []).map((insp) => inspectionDate(insp)?.getTime() || 0))
    const keyed = filteredRestaurants.map((r) => ({
      r,
      key:
        sortOrder === 'violations'
          ? [r.violationStats?.inspectionCount ? 1 : 0, r.violationStats?.total || 0, r.violationStats?.critical || 0]
          : [latestTime(r)],
    }))
    keyed.sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) {
        if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i]
      }
      return a.r.name.localeCompare(b.r.name)
    })
    return keyed.map((entry) => entry.r)
  }, [filteredRestaurants, sortOrder])

  // Filters narrowed from their "show everything" defaults. The legend's
  // violation buckets count too: they hide list rows just like the chips do.
  const activeFilterCount =
    (selectedHazardRatings.length < HAZARD_RATING_OPTIONS.length ? 1 : 0) +
    (selectedFacilityTypes.length < FACILITY_TYPE_OPTIONS.length ? 1 : 0) +
    (visualizationMode === 'violations' && selectedViolationBuckets.length < FOOD_VIOLATION_BUCKETS.length ? 1 : 0)

  const resetFilters = useCallback(() => {
    actions.applyFilters({
      hazardRatings: [...HAZARD_RATING_OPTIONS],
      facilityTypes: [...FACILITY_TYPE_OPTIONS],
      searchQuery: '',
    })
    setSelectedViolationBuckets([...FOOD_VIOLATION_BUCKETS])
  }, [actions])

  // The URL param is the single source of truth for the selection: deriving
  // the selected restaurant from it (rather than mirroring it into local
  // state) means clearing the param dismisses the card, deep links restore
  // it, and the object always carries the latest timeline-filtered stats.
  const selectedRestaurant = useMemo<RestaurantWithStats | null>(() => {
    if (!restaurantName) return null
    return restaurantsWithStats.find((item) => item.name === restaurantName) ?? null
  }, [restaurantName, restaurantsWithStats])

  // Stats for the current timeline
  const timelineStats = useMemo(() => {
    const all = scopedWithStats
    return {
      totalViolations: all.reduce((sum, r) => sum + (r.violationStats?.total || 0), 0),
      criticalViolations: all.reduce((sum, r) => sum + (r.violationStats?.critical || 0), 0),
      totalInspections: all.reduce((sum, r) => sum + (r.violationStats?.inspectionCount || 0), 0),
      restaurantsWithViolations: all.filter((r) => (r.violationStats?.total || 0) > 0).length,
    }
  }, [scopedWithStats])

  // Hazard stats at the selected date
  const hazardStatsAtDate = useMemo(() => {
    const all = scopedWithStats
    return {
      Low: all.filter((r) => r.hazardRatingAtDate === 'Low').length,
      Moderate: all.filter((r) => r.hazardRatingAtDate === 'Moderate').length,
      High: all.filter((r) => r.hazardRatingAtDate === 'High').length,
      Unknown: all.filter((r) => r.hazardRatingAtDate === 'Unknown').length,
    }
  }, [scopedWithStats])

  const reachesSparseRecords = (violationDateRange.start ?? inspectionDateRange.start) < VIOLATION_RATE_SHIFT

  const timelineSummary = useMemo(() => {
    if (visualizationMode === 'hazard') {
      const worse = monthRatingChanges.filter((change) => change.direction === 'worse').length
      return [
        plural(monthRatingChanges.length, 'rating change'),
        `${worse} worse`,
        `${monthRatingChanges.length - worse} better`,
      ].join(' · ')
    }
    // The row holds about 45 characters beside the window and speed controls,
    // so the early-record warning replaces the counts the sidebar also shows.
    if (reachesSparseRecords) return `Far fewer violations before ${formatMonthYear(VIOLATION_RATE_SHIFT)}`
    return [
      plural(timelineStats.totalInspections, 'inspection'),
      `${timelineStats.criticalViolations.toLocaleString()} critical`,
    ].join(' · ')
  }, [visualizationMode, monthRatingChanges, timelineStats, reachesSparseRecords])

  const violationBucketRows = useMemo(() => {
    const counts = new Map<ViolationBucket, number>()
    restaurantsWithStats.forEach((restaurant) => {
      const bucket = getViolationBucket(restaurant.violationStats)
      counts.set(bucket, (counts.get(bucket) || 0) + 1)
    })
    return VIOLATION_BUCKET_STYLES.map((bucket) => ({
      ...bucket,
      count: counts.get(bucket.key) || 0,
      active: selectedViolationBuckets.includes(bucket.key),
    }))
  }, [restaurantsWithStats, selectedViolationBuckets])
  const showLegend =
    visualizationMode === 'violations' ? selectedViolationBuckets.length > 0 : selectedHazardRatings.length > 0

  const toggleHazardRating = useToggleArray(selectedHazardRatings, actions.setHazardRatings)

  const toggleViolationBucket = useCallback((bucket: ViolationBucket) => {
    setSelectedViolationBuckets((current) => toggleArrayItem(current, bucket))
  }, [])

  // Handlers
  const selectRestaurant = useCallback(
    (restaurant: RestaurantWithStats | null) => {
      setRestaurantName(restaurant ? restaurant.name : '')
    },
    [setRestaurantName],
  )

  const handleRestaurantClick = useCallback(
    (restaurant: RestaurantWithStats) => {
      const active = document.activeElement
      selectedRowTrigger.current =
        active instanceof HTMLButtonElement && active.dataset.restaurantId === restaurant.details_url ? active : null
      selectRestaurant(selectedRestaurant?.details_url === restaurant.details_url ? null : restaurant)
    },
    [selectRestaurant, selectedRestaurant],
  )

  const handleMapRestaurantClick = useCallback(
    (restaurant: RestaurantWithStats) => {
      handleRestaurantClick(restaurant)
      setShowSidebar(true)
    },
    [handleRestaurantClick],
  )

  const handleRatingChangeClick = useCallback(
    (change: RatingChange) => {
      const restaurant = restaurantsWithStats.find((item) => item.details_url === change.restaurant.details_url)
      if (restaurant) selectRestaurant(restaurant)
    },
    [restaurantsWithStats, selectRestaurant],
  )

  const clearSelection = useCallback(() => {
    selectRestaurant(null)
    setShowInspectionPanel(false)
    const trigger = selectedRowTrigger.current
    if (trigger?.isConnected) {
      requestAnimationFrame(() => {
        const rect = trigger.getBoundingClientRect()
        if (rect.width && rect.top >= 0 && rect.bottom <= window.innerHeight) trigger.focus({ preventScroll: true })
        else document.querySelector<HTMLElement>('[data-map-mobile-sheet-handle]')?.focus({ preventScroll: true })
      })
    }
  }, [selectRestaurant])

  const openInspectionPanel = useCallback(() => {
    setShowInspectionPanel(true)
  }, [])

  const handleMapViewInspections = useCallback(
    (restaurant: RestaurantWithStats) => {
      selectRestaurant(restaurant)
      setShowSidebar(true)
      setShowInspectionPanel(true)
    },
    [selectRestaurant],
  )

  const handleRouletteSelectOnMap = useCallback(
    (restaurant: RestaurantWithStats) => {
      selectRestaurant(restaurant)
      setShowRoulette(false)
      setShowSidebar(true)
    },
    [selectRestaurant],
  )

  const inspectionsThroughLabel = formatMonthYear(inspectionDateRange.end)
  const tableSources = useMemo(
    () => [
      defineTableSource<RestaurantWithStats>({
        id: 'restaurants',
        label: 'Restaurants',
        color: '#f59e0b',
        shape: 'point',
        // Includes places without coordinates, which the sidebar lists and the map cannot draw.
        rows: filteredRestaurants,
        columns: foodTableColumns(visualizationMode, parseInspectionDate),
        getRowId: (restaurant) => restaurant.details_url,
        getRowCenter: (restaurant) =>
          restaurant.latitude && restaurant.longitude ? [restaurant.longitude, restaurant.latitude] : null,
        status: loading ? 'loading' : error ? 'error' : 'ready',
        emptyMessage: error ?? 'No restaurants match these filters.',
        exportFileName: 'food-safety-restaurants',
      }),
    ],
    [error, filteredRestaurants, loading, visualizationMode],
  )
  const table = useMapTable({
    sources: tableSources,
    selectedRowId: selectedRestaurant?.details_url ?? null,
    onSelectRow: (restaurant: RestaurantWithStats) => {
      selectRestaurant(restaurant)
      setShowSidebar(true)
    },
    // RestaurantMap flies to the selected restaurant, which also covers a click on a marker.
    flyOnSelect: false,
  })

  useFoodMapWebMCP({
    loading,
    error,
    restaurants: restaurantsWithStats,
    filteredRestaurants,
    geocodedRestaurants,
    selectedRestaurant,
    filters,
    filterActions: actions,
    selectedViolationBuckets,
    setSelectedViolationBuckets,
    violationTimelineLabel,
    inspectionsThroughLabel,
    timelineStats,
    hazardStatsAtDate,
    crimeIncidents,
    crimeLoading,
    crimeError,
    clearSelection,
    selectRestaurant,
    showRestaurant: () => setShowSidebar(true),
    showInspections: openInspectionPanel,
  })

  return (
    <>
      <MapSectionLayout
        table={table}
        showDesktopSidebar={showSidebar}
        onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
        mobilePeek={
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-left">
              <div className="truncate text-xs font-semibold text-foreground">
                Food Safety · {geocodedRestaurants.length.toLocaleString(DEFAULT_LOCALE)} on map
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {selectedRestaurant?.name ||
                  (visualizationMode === 'violations'
                    ? `Violations · ${violationTimelineLabel}`
                    : `Hazard ratings · as of ${formatMonthYear(timelineDate)}`)}
              </div>
            </div>
            {/* Sits in the sheet's drag handle. The attribute is what keeps a tap from
                moving the sheet: its gestures are native touch listeners, which run
                before React's stopPropagation below can reach them. */}
            <button
              type="button"
              data-map-mobile-sheet-peek-action="true"
              onClick={(event) => {
                event.stopPropagation()
                setShowRoulette(true)
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              aria-label="Open restaurant roulette"
            >
              <Dices className="h-4 w-4" aria-hidden="true" />
              Roulette
            </button>
          </div>
        }
        selectedFeatureMobilePeek={
          selectedRestaurant
            ? {
                title: selectedRestaurant.name,
                subtitle: formatFullAddress(selectedRestaurant),
              }
            : undefined
        }
        sidebar={
          <Sidebar
            className={MAP_SIDEBAR_CLASS}
            data={{
              restaurants: sortedRestaurants,
              geocodedRestaurants,
              loading,
              error,
              stats,
              timelineStats,
              hazardStatsAtDate,
              violationTimelineLabel,
              inspectionsThroughLabel,
              hazardDateLabel: formatMonthYear(timelineDate),
              monthRatingChanges,
              activeFilterCount,
            }}
            filters={filters}
            filterActions={actions}
            onResetFilters={resetFilters}
            selectedRestaurant={selectedRestaurant}
            showTimeline={showTimeline}
            onRestaurantClick={handleRestaurantClick}
            onClearSelection={clearSelection}
            onOpenInspectionPanel={openInspectionPanel}
            onToggleTimeline={() => setShowTimeline(!showTimeline)}
            onRatingChangeClick={handleRatingChangeClick}
            onOpenRoulette={() => setShowRoulette(true)}
          />
        }
      >
        <div className="relative h-full">
          <MapTableBridge table={table} />
          <MapScaleBar position="bottom-left" className="max-md:hidden" />
          <RestaurantMap
            restaurants={geocodedRestaurants}
            selectedRestaurant={selectedRestaurant}
            visualizationMode={visualizationMode}
            markerStyle={filters.markerStyle}
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
              bucketCounts={timelineBars}
              bucketValueLabel={visualizationMode === 'violations' ? 'critical violations' : 'rating changes'}
              statsLabel={timelineSummary}
              windowMode={
                visualizationMode === 'violations'
                  ? {
                      size: timelineMonths === 0 ? -1 : timelineMonths,
                      onSizeChange: (size) => actions.setTimelineMonths(size === -1 ? 0 : size),
                      options: WINDOW_OPTIONS,
                      anchor: 'end',
                    }
                  : undefined
              }
            />
          )}

          {showLegend && (
            <MapLegendPanel
              width="sm"
              title={visualizationMode === 'violations' ? 'Violations' : 'Hazard rating'}
              collapsible
              collapsed={legendCollapsed}
              onCollapsedChange={setLegendCollapsed}
              contentClassName="space-y-1 text-xs text-muted-foreground"
              actions={
                legendCollapsed ? null : visualizationMode === 'violations' ? (
                  <SelectAllActions
                    onAll={() => setSelectedViolationBuckets([...FOOD_VIOLATION_BUCKETS])}
                    onNone={() => setSelectedViolationBuckets([])}
                  />
                ) : (
                  <SelectAllActions
                    onAll={() => actions.setHazardRatings([...HAZARD_RATING_OPTIONS])}
                    onNone={() => actions.setHazardRatings([])}
                  />
                )
              }
            >
              {/* Violations legend */}
              {visualizationMode === 'violations' && (
                <div className="space-y-0.5 md:space-y-1">
                  <div className="pb-0.5 text-xs leading-snug text-muted-foreground">{violationTimelineLabel}</div>
                  {reachesSparseRecords && (
                    <p className="pb-0.5 text-xs leading-snug text-muted-foreground">
                      Inspections found far fewer violations before {formatMonthYear(VIOLATION_RATE_SHIFT)}. The record
                      doesn&apos;t say why, so earlier months may not compare.
                    </p>
                  )}
                  {violationBucketRows.map((bucket) => (
                    <LegendItem
                      key={bucket.key}
                      color={bucket.color}
                      label={bucket.label}
                      value={bucket.count.toLocaleString(DEFAULT_LOCALE)}
                      active={bucket.active}
                      onClick={() => toggleViolationBucket(bucket.key)}
                    />
                  ))}
                </div>
              )}

              {/* Hazard rating legend with counts */}
              {visualizationMode === 'hazard' && (
                <div className="space-y-0.5 md:space-y-1">
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
                    color="#ef4444"
                    label="High"
                    value={hazardStatsAtDate.High}
                    active={selectedHazardRatings.includes('High')}
                    onClick={() => toggleHazardRating('High')}
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
