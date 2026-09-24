import { useRef, type ReactNode } from 'react'
import { Dices, History, X } from 'lucide-react'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { RestaurantCard } from './RestaurantCard'
import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/ui/select'
import { FilterChipGroup, MapSidebarShell, MobileCollapsibleSection, SearchInput } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatGroup } from '@/components/ui/stat-group'
import { SelectAllActions } from '@/components/ui/text-button'
import { ListState } from '@/components/ui/result-list'
import {
  FilterToggleButton,
  ResetFiltersButton,
  StickyListToolbar,
  useRevealBelowSticky,
  useStickyListToolbar,
} from '@/components/ui/sticky-list-toolbar'
import { DATASETS } from '@/lib/dataCatalog'
import { useToggleArray } from '@/hooks/useToggleArray'
import {
  FACILITY_TYPE_OPTIONS,
  HAZARD_RATING_OPTIONS,
  MARKER_STYLE_OPTIONS,
  SORT_OPTIONS,
  type FoodMapFilters,
  type FoodMapFilterActions,
} from '../hooks/useFoodMapFilters'
import type { FoodSortOrder, MarkerStyle } from '../types'
import type {
  RestaurantWithStats,
  RestaurantStats,
  TimelineStats,
  HazardStatsAtDate,
  HazardRating,
} from '../types'

export interface SidebarData {
  /** Filtered and sorted for the list. */
  restaurants: RestaurantWithStats[]
  geocodedRestaurants: RestaurantWithStats[]
  loading: boolean
  error: string | null
  stats: RestaurantStats
  timelineStats: TimelineStats
  hazardStatsAtDate: HazardStatsAtDate
  violationTimelineLabel: string
  /** Month the hazard ratings are read at, e.g. "Sep 2026". */
  hazardDateLabel: string
  activeFilterCount: number
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
  onResetFilters: () => void
}

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

// The dot style selector is experimental and hidden for now. Cluster reveal is
// the default (see useFoodMapFilters). Keep the selector wired up so we can
// expose the other marker styles again in the future.
const SHOW_DOT_STYLE_SELECTOR = false

function FilterGroup({
  title,
  caption,
  onAll,
  onNone,
  children,
}: {
  title: string
  caption?: string
  onAll: () => void
  onNone: () => void
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          {title}
          {caption && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{caption}</span>}
        </h3>
        <SelectAllActions onAll={onAll} onNone={onNone} />
      </div>
      {children}
    </div>
  )
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
  onResetFilters,
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
    hazardDateLabel,
    activeFilterCount,
  } = data
  const {
    hazardRatings: selectedHazardRatings,
    facilityTypes: selectedFacilityTypes,
    searchQuery,
    visualizationMode,
    timelineMonths,
    violationTimelineMode,
    sortOrder,
  } = filters

  const { toolbarRef, filtersPanelId, filtersOpen: showFilters, toggleFilters } = useStickyListToolbar()
  const selectedCardRef = useRef<HTMLDivElement>(null)

  const toggleHazard = useToggleArray(selectedHazardRatings, filterActions.setHazardRatings)
  const toggleFacility = useToggleArray(selectedFacilityTypes, filterActions.setFacilityTypes)

  const unmappedCount = restaurants.length - geocodedRestaurants.length
  const hasActiveFilters = activeFilterCount > 0 || searchQuery !== ''
  // Hazard chips filter on the rating the active mode uses, so count that one.
  const hazardCounts: Partial<Record<HazardRating, number>> =
    visualizationMode === 'hazard' ? hazardStatsAtDate : stats?.byHazard ?? {}

  // A pick from the list or the map inserts the detail card above the list,
  // out of view if the list was scrolled. Scroll it in (desktop only: the
  // card is hidden on phones, where the map shows its own feature card).
  useRevealBelowSticky(toolbarRef, selectedCardRef, selectedRestaurant?.details_url)

  return (
    <MapSidebarShell
      className={className}
      title="Food Safety"
      subtitle="Food Establishment Inspections"
      dataset={DATASETS.foodSafety}
      hideTitleOnMobile
      actions={
        <button
          type="button"
          onClick={onOpenRoulette}
          className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Restaurant roulette"
          aria-label="Restaurant roulette"
        >
          <Dices className="h-4 w-4" aria-hidden="true" />
        </button>
      }
    >
      {/* What the map shows, and for when. Folds to one line on phones. */}
      <MobileCollapsibleSection
        label="Map options"
        summary={
          visualizationMode === 'violations'
            ? `Violations · ${timelineOptions.find((opt) => opt.value === timelineMonths)?.label ?? `${timelineMonths} months`} · ${violationTimelineMode === 'period' ? 'Period' : 'Cumulative'}`
            : `Hazard rating · as of ${hazardDateLabel}`
        }
      >
        <div className="space-y-2 p-3 max-md:pt-0">
          <SegmentedControl
            label="Map colours"
            value={visualizationMode}
            onChange={filterActions.setVisualizationMode}
            options={[
              { value: 'violations', label: 'Violations' },
              { value: 'hazard', label: 'Hazard rating' },
            ]}
          />

          {visualizationMode === 'violations' && (
            <div className="flex items-center gap-2">
              <SegmentedControl
                label="Count violations"
                size="sm"
                className="flex-1"
                value={violationTimelineMode}
                onChange={filterActions.setViolationTimelineMode}
                options={[
                  { value: 'period', label: 'Period' },
                  { value: 'cumulative', label: 'Cumulative' },
                ]}
              />
              <AppSelect
                value={String(timelineMonths)}
                onValueChange={(value) => filterActions.setTimelineMonths(parseInt(value))}
                options={timelineOptions.map((opt) => ({ value: String(opt.value), label: opt.label }))}
                className="w-28"
                triggerAriaLabel="Period length"
                triggerClassName="h-8 rounded text-xs focus:ring-2 focus:ring-sky-500"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">
              {visualizationMode === 'violations' ? violationTimelineLabel : `Ratings as of ${hazardDateLabel}`}
            </span>
            <button
              type="button"
              onClick={onToggleTimeline}
              aria-pressed={showTimeline}
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors touch:min-h-9',
                showTimeline
                  ? 'bg-sky-100 text-sky-800 hover:bg-sky-200 dark:bg-sky-900/50 dark:text-sky-200 dark:hover:bg-sky-900'
                  : 'text-sky-700 hover:bg-accent dark:text-sky-400',
              )}
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              {showTimeline ? 'Hide timeline' : 'Timeline'}
            </button>
          </div>
        </div>
      </MobileCollapsibleSection>

      {/* Experimental dot style selector (hidden for now, kept for future use) */}
      {SHOW_DOT_STYLE_SELECTOR && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-2">
          <span className="text-xs text-muted-foreground">Dot style</span>
          <AppSelect
            value={filters.markerStyle}
            onValueChange={(value) => filterActions.setMarkerStyle(value as MarkerStyle)}
            options={MARKER_STYLE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
            className="w-40"
            triggerClassName="h-8 rounded text-xs focus:ring-2 focus:ring-sky-500"
          />
        </div>
      )}

      {/* Totals for the active mode */}
      <div className="border-b border-border bg-background/95 px-4 py-2">
        <StatGroup
          items={
            visualizationMode === 'violations'
              ? [
                  { label: 'violations', value: timelineStats?.totalViolations || 0 },
                  { label: 'critical', value: timelineStats?.criticalViolations || 0, tone: 'danger' },
                  { label: 'inspections', value: timelineStats?.totalInspections || 0 },
                  { label: 'with violations', value: timelineStats?.restaurantsWithViolations || 0 },
                ]
              : [
                  { label: 'low', value: hazardStatsAtDate?.Low || 0, tone: 'success' },
                  { label: 'moderate', value: hazardStatsAtDate?.Moderate || 0, tone: 'warning' },
                  { label: 'unknown', value: hazardStatsAtDate?.Unknown || 0, tone: 'muted' },
                ]
          }
        />
      </div>

      {/* Search, filters and sort stay reachable while the list scrolls. */}
      <StickyListToolbar
        ref={toolbarRef}
        search={
          <SearchInput
            value={searchQuery}
            onChange={(e) => filterActions.setSearchQuery(e.target.value)}
            onClear={() => filterActions.setSearchQuery('')}
            icon
            placeholder="Search establishments..."
            aria-label="Search establishments"
            className="focus:ring-sky-500"
          />
        }
        controls={
          <>
            <FilterToggleButton
              open={showFilters}
              onToggle={toggleFilters}
              panelId={filtersPanelId}
              activeCount={activeFilterCount}
            />
            {hasActiveFilters && <ResetFiltersButton onClick={onResetFilters} />}
          </>
        }
        sort={
          <AppSelect
            value={sortOrder}
            onValueChange={(value) => filterActions.setSortOrder(value as FoodSortOrder)}
            options={SORT_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
            className="w-40"
            triggerAriaLabel="Sort establishments"
            triggerClassName="h-8 rounded text-xs focus:ring-2 focus:ring-sky-500 touch:h-10"
          />
        }
        count={
          !loading && !error ? (
            <>
              {restaurants.length.toLocaleString('en-CA')} {restaurants.length === 1 ? 'establishment' : 'establishments'}
              {unmappedCount > 0 && ` · ${unmappedCount.toLocaleString('en-CA')} not on map`}
            </>
          ) : undefined
        }
      />

      {/* Filters panel */}
      {showFilters && (
        <div id={filtersPanelId} className="space-y-4 border-b border-border bg-muted/30 p-4">
          <FilterGroup
            title="Hazard rating"
            caption={visualizationMode === 'hazard' ? `as of ${hazardDateLabel}` : 'current'}
            onAll={() => filterActions.setHazardRatings([...HAZARD_RATING_OPTIONS])}
            onNone={() => filterActions.setHazardRatings([])}
          >
            <FilterChipGroup
              variant="filled"
              items={HAZARD_RATING_OPTIONS.map((hazard) => ({
                value: hazard,
                label: hazard,
                count: hazardCounts[hazard] || 0,
                color: hazardChipColors[hazard],
              }))}
              selectedValues={selectedHazardRatings}
              onToggle={toggleHazard}
              chipClassName="px-3 py-1"
            />
          </FilterGroup>

          <FilterGroup
            title="Facility type"
            onAll={() => filterActions.setFacilityTypes([...FACILITY_TYPE_OPTIONS])}
            onNone={() => filterActions.setFacilityTypes([])}
          >
            <FilterChipGroup
              variant="filled"
              items={FACILITY_TYPE_OPTIONS.filter((facility) => (stats?.byFacilityType?.[facility] || 0) > 0).map(
                (facility) => ({
                  value: facility,
                  label: facility,
                  count: stats?.byFacilityType?.[facility] || 0,
                  color: '#0ea5e9',
                }),
              )}
              selectedValues={selectedFacilityTypes}
              onToggle={toggleFacility}
              chipClassName="px-3 py-1"
              showDot={false}
            />
          </FilterGroup>
        </div>
      )}

      {/* Selected establishment */}
      {selectedRestaurant && (
        <div
          ref={selectedCardRef}
          className="hidden border-b border-sky-300/60 bg-sky-50 p-3 dark:border-sky-800/60 dark:bg-sky-950/30 md:block"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">Selected</span>
            <button
              type="button"
              onClick={onClearSelection}
              aria-label="Clear selection"
              className="rounded p-0.5 text-sky-700 transition-colors hover:bg-sky-100 hover:text-foreground dark:text-sky-300 dark:hover:bg-sky-900/50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <RestaurantCard
            restaurant={selectedRestaurant}
            expanded
            visualizationMode={visualizationMode}
            className="p-0"
          />
          <button
            type="button"
            onClick={onOpenInspectionPanel}
            className="mt-3 w-full rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950"
          >
            Inspection history
          </button>
        </div>
      )}

      {/* Results */}
      <ListState
        loading={loading}
        loadingLabel="Loading establishments..."
        error={error}
        errorTitle="Could not load inspections"
        empty={restaurants.length === 0}
        emptyLabel="No establishments match these filters."
        onReset={hasActiveFilters ? onResetFilters : undefined}
      >
        <VirtualResultList items={restaurants} getKey={(restaurant) => restaurant.details_url} estimateSize={96} label="Establishments">
          {(restaurant) => (
            <RestaurantCard
              key={restaurant.details_url}
              restaurant={restaurant}
              isSelected={selectedRestaurant?.details_url === restaurant.details_url}
              visualizationMode={visualizationMode}
              onClick={() => onRestaurantClick(restaurant)}
            />
          )}
        </VirtualResultList>
      </ListState>
    </MapSidebarShell>
  )
}
