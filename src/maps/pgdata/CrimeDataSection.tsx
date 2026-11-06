import { useCallback, useMemo, useState } from 'react'
import { useTimelineState } from '@/hooks/useTimelineState'
import { useSearchParams } from 'react-router-dom'
import { useUrlParamSync } from '@/hooks/useUrlState'
import { formatNumber } from '@/lib/format'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { defineTableSource, useMapTable } from '@/components/map/useMapTable'
import { HEATMAP_COLOR_RAMPS } from '@/components/ui/map-styles'
import { LegendItem, MapGradientLegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { CrimeMap } from './components/CrimeMap'
import { CrimeSidebar } from './components/CrimeSidebar'
import { CRIME_TABLE_COLUMNS } from './components/CrimeTable'
import { Timeline } from '@/components/ui/timeline'
import { getCrimeCategory, CRIME_CATEGORY_COLORS } from './constants'
import { useCrimeData } from './hooks/useCrimeData'
import type { CrimeIncident, CrimeCategory } from './types'

const ALL_CATEGORIES = Object.keys(CRIME_CATEGORY_COLORS) as CrimeCategory[]
const HEATMAP_LEGEND_COLORS = HEATMAP_COLOR_RAMPS.crime.slice(1).map(([, color]) => color)

export default function CrimeDataSection() {
  const [searchParams] = useSearchParams()
  const currentTab = searchParams.get('tab')
  const { incidents, loading, error } = useCrimeData()

  // Layer visibility
  const [showCrimeLayer, setShowCrimeLayer] = useState(true)

  // Crime filters
  const [selectedCategories, setSelectedCategories] = useState<CrimeCategory[]>(ALL_CATEGORIES)
  // null means "no explicit selection yet" and resolves to every year, so no
  // initialization effect is needed once incidents load.
  const [selectedYearsOverride, setSelectedYearsOverride] = useState<number[] | null>(null)
  const [selectedCommunity, setSelectedCommunity] = useState(() => searchParams.get('community') || '')
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [showHeatmap, setShowHeatmap] = useState(() => searchParams.get('heatmap') === '1')
  const [selectedIncident, setSelectedIncident] = useState<CrimeIncident | null>(null)
  const {
    timelineEnabled,
    setTimelineEnabled,
    timelineDate,
    setTimelineDate,
    timelineWindowSize,
    setTimelineWindowSize,
    disableTimeline,
  } = useTimelineState(1)

  const allYears = useMemo(() => {
    const years = new Set(incidents.map((inc) => inc.date.getFullYear()))
    return Array.from(years).sort((a, b) => b - a)
  }, [incidents])

  const selectedYears = selectedYearsOverride ?? allYears

  const allCommunities = useMemo(() => {
    const communities = new Set(incidents.map((inc) => inc.community).filter(Boolean))
    return Array.from(communities).sort()
  }, [incidents])

  const baseFilteredIncidents = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return incidents.filter((inc) => {
      const category = getCrimeCategory(inc.crimeType)
      if (!selectedCategories.includes(category)) return false
      if (selectedYears.length > 0 && !selectedYears.includes(inc.date.getFullYear())) return false
      if (selectedCommunity && inc.community !== selectedCommunity) return false
      if (normalizedQuery) {
        const text = [inc.address, inc.fileNumber, inc.community, inc.crimeType].join(' ').toLowerCase()
        if (!text.includes(normalizedQuery)) return false
      }
      return true
    })
  }, [incidents, selectedCategories, selectedYears, selectedCommunity, searchQuery])

  const incidentDateRange = useMemo(() => {
    if (incidents.length === 0) {
      const now = new Date()
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
    }
    let min = incidents[0].date
    let max = incidents[0].date
    for (const inc of incidents) {
      if (inc.date < min) min = inc.date
      if (inc.date > max) max = inc.date
    }
    return { start: min, end: max }
  }, [incidents])

  // The scrub defaults to the most recent incident month until the user picks
  // one explicitly; deriving it avoids a state write when the timeline opens.
  const effectiveTimelineDate = useMemo(() => {
    if (timelineDate) return timelineDate
    return incidents.length > 0
      ? new Date(incidentDateRange.end.getFullYear(), incidentDateRange.end.getMonth(), 1)
      : null
  }, [timelineDate, incidents.length, incidentDateRange.end])

  const filteredIncidents = useMemo(() => {
    if (!timelineEnabled || !effectiveTimelineDate) return baseFilteredIncidents
    const timelineDate = effectiveTimelineDate
    const isCumulative = timelineWindowSize === -1
    const startMs = isCumulative
      ? new Date(incidentDateRange.start.getFullYear(), incidentDateRange.start.getMonth(), 1).getTime()
      : new Date(timelineDate.getFullYear(), timelineDate.getMonth(), 1).getTime()
    const monthsForward = isCumulative ? 1 : timelineWindowSize
    const endMs = new Date(
      timelineDate.getFullYear(),
      timelineDate.getMonth() + monthsForward,
      0,
      23,
      59,
      59,
      999,
    ).getTime()
    return baseFilteredIncidents.filter((inc) => {
      const t = inc.date.getTime()
      return t >= startMs && t <= endMs
    })
  }, [baseFilteredIncidents, timelineEnabled, effectiveTimelineDate, timelineWindowSize, incidentDateRange.start])

  // Sync filters to URL for shareable links. This used to build from an empty
  // URLSearchParams, which silently dropped every param this section does not
  // own; useUrlParamSync writes through the current params instead.
  useUrlParamSync({
    tab: currentTab,
    q: searchQuery,
    community: selectedCommunity,
    heatmap: showHeatmap ? '1' : null,
  })

  const toggleCategory = useCallback((category: CrimeCategory) => {
    setSelectedCategories((current) =>
      current.includes(category) ? current.filter((c) => c !== category) : [...current, category],
    )
  }, [])

  const toggleYear = useCallback(
    (year: number) => {
      setSelectedYearsOverride((current) => {
        const base = current ?? allYears
        return base.includes(year) ? base.filter((y) => y !== year) : [...base, year]
      })
    },
    [allYears],
  )

  // A selection that filters drop out of view simply stops rendering; the
  // stored state is harmless and avoids an effect-driven clear.
  const visibleSelectedIncident = useMemo(() => {
    if (!selectedIncident) return null
    return filteredIncidents.some((inc) => inc.id === selectedIncident.id) ? selectedIncident : null
  }, [filteredIncidents, selectedIncident])

  const tableSources = useMemo(
    () =>
      showCrimeLayer
        ? [
            defineTableSource<CrimeIncident>({
              id: 'incidents',
              label: 'Crime incidents',
              color: '#f43f5e',
              shape: 'point',
              rows: filteredIncidents,
              columns: CRIME_TABLE_COLUMNS,
              getRowId: (incident) => String(incident.id),
              getRowCenter: (incident) => [incident.longitude, incident.latitude],
              flyZoom: 15,
              status: loading ? 'loading' : error ? 'error' : 'ready',
              emptyMessage: error ?? 'No incidents match the current filters.',
              exportFileName: 'pg-crime-incidents',
            }),
          ]
        : [],
    [error, filteredIncidents, loading, showCrimeLayer],
  )
  const table = useMapTable({
    sources: tableSources,
    selectedRowId: visibleSelectedIncident ? String(visibleSelectedIncident.id) : null,
    onSelectRow: setSelectedIncident,
    // CrimeMap flies to the selected incident, which also covers a click on a point.
    flyOnSelect: false,
  })

  // Build legend items for active layers
  const legendItems = useMemo(() => {
    const items: Array<{ color: string; label: string }> = []

    if (showCrimeLayer && !showHeatmap) {
      selectedCategories.forEach((cat) => {
        items.push({ color: CRIME_CATEGORY_COLORS[cat], label: cat })
      })
    }

    return items
  }, [showCrimeLayer, showHeatmap, selectedCategories])

  const showLegend = (showCrimeLayer && showHeatmap) || legendItems.length > 0

  return (
    <MapSectionLayout
      table={table}
      mobilePeekTitle={<>PG Data · {formatNumber(filteredIncidents.length)} incidents</>}
      mobilePeekSubtitle={
        <>{visibleSelectedIncident?.crimeType || selectedCommunity || `${selectedCategories.length} categories`}</>
      }
      sidebar={
        <CrimeSidebar
          className={MAP_SIDEBAR_CLASS}
          incidents={incidents}
          filteredIncidents={filteredIncidents}
          selectedIncident={visibleSelectedIncident}
          selectedCategories={selectedCategories}
          selectedYears={selectedYears}
          selectedCommunity={selectedCommunity}
          searchQuery={searchQuery}
          showHeatmap={showHeatmap}
          timelineEnabled={timelineEnabled}
          loading={loading}
          error={error}
          allYears={allYears}
          allCommunities={allCommunities}
          onToggleCategory={toggleCategory}
          onSelectAllCategories={() => setSelectedCategories(ALL_CATEGORIES)}
          onClearCategories={() => setSelectedCategories([])}
          onToggleYear={toggleYear}
          onSelectAllYears={() => setSelectedYearsOverride(null)}
          onCommunityChange={setSelectedCommunity}
          onSearchChange={setSearchQuery}
          onToggleHeatmap={() => setShowHeatmap((h) => !h)}
          onToggleTimeline={() => setTimelineEnabled((t) => !t)}
          onIncidentClick={setSelectedIncident}
          onClearSelection={() => setSelectedIncident(null)}
          // Layers
          showCrimeLayer={showCrimeLayer}
          onToggleCrimeLayer={() => setShowCrimeLayer((v) => !v)}
        />
      }
    >
      <div className="relative h-full">
        <CrimeMap
          incidents={filteredIncidents}
          selectedIncident={visibleSelectedIncident}
          showHeatmap={showHeatmap}
          onIncidentClick={setSelectedIncident}
          onIncidentClear={() => setSelectedIncident(null)}
          showCrimeLayer={showCrimeLayer}
          loading={loading}
          table={table}
        />

        {/* Timeline */}
        {timelineEnabled && !loading && effectiveTimelineDate && (
          <Timeline
            startDate={incidentDateRange.start}
            endDate={incidentDateRange.end}
            currentDate={effectiveTimelineDate}
            onDateChange={setTimelineDate}
            onClose={disableTimeline}
            windowMode={{
              size: timelineWindowSize,
              onSizeChange: setTimelineWindowSize,
            }}
          />
        )}

        {/* Legend */}
        {showLegend && (
          <MapLegendPanel
            title={showCrimeLayer && showHeatmap ? 'Heatmap (Crime Density)' : 'Legend'}
            collapsible
            defaultCollapsed="mobile"
          >
            {showCrimeLayer && showHeatmap ? (
              <MapGradientLegendItem colors={HEATMAP_LEGEND_COLORS} minLabel="Low" maxLabel="High" />
            ) : (
              <div className="space-y-2">
                {/* Point legends */}
                {legendItems.length > 0 && (
                  <MapLegendSection title="Layers">
                    {legendItems.map((item) => (
                      <LegendItem key={item.label} color={item.color} label={item.label} />
                    ))}
                  </MapLegendSection>
                )}
              </div>
            )}
          </MapLegendPanel>
        )}
      </div>
    </MapSectionLayout>
  )
}
