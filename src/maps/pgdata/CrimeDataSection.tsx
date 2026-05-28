import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { COLOR_SCALES } from '@/components/ui/map-styles'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { LegendItem, MapGradientLegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { CrimeMap } from './components/CrimeMap'
import { CrimeSidebar } from './components/CrimeSidebar'
import { Timeline } from '@/components/ui/timeline'
import { getCrimeCategory, CRIME_CATEGORY_COLORS } from './constants'
import { useCrimeData } from './hooks/useCrimeData'
import { useAirMonitorOverlay } from './hooks/useAirMonitorOverlay'
import { useCensusOverlay } from './hooks/useCensusOverlay'
import type { CrimeIncident, CrimeCategory } from './types'

const ALL_CATEGORIES = Object.keys(CRIME_CATEGORY_COLORS) as CrimeCategory[]

export default function CrimeDataSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentTab = searchParams.get('tab')
  const { incidents, loading, error } = useCrimeData()
  const airOverlay = useAirMonitorOverlay()
  const censusOverlay = useCensusOverlay()

  // Layer visibility
  const [showCrimeLayer, setShowCrimeLayer] = useState(true)
  const [showAirQualityLayer, setShowAirQualityLayer] = useState(false)
  const [showCensusLayer, setShowCensusLayer] = useState(false)

  // Crime filters
  const [selectedCategories, setSelectedCategories] = useState<CrimeCategory[]>(ALL_CATEGORIES)
  const [selectedYears, setSelectedYears] = useState<number[]>([])
  const [yearsInitialized, setYearsInitialized] = useState(false)
  const [selectedCommunity, setSelectedCommunity] = useState(() => searchParams.get('community') || '')
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [showHeatmap, setShowHeatmap] = useState(() => searchParams.get('heatmap') === '1')
  const [selectedIncident, setSelectedIncident] = useState<CrimeIncident | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [timelineWindowSize, setTimelineWindowSize] = useState(1)

  const allYears = useMemo(() => {
    const years = new Set(incidents.map((inc) => inc.date.getFullYear()))
    return Array.from(years).sort((a, b) => b - a)
  }, [incidents])

  useEffect(() => {
    if (!yearsInitialized && allYears.length > 0) {
      setSelectedYears(allYears)
      setYearsInitialized(true)
    }
  }, [allYears, yearsInitialized])

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
        const text = [inc.address, inc.fileNumber, inc.community, inc.crimeType]
          .join(' ')
          .toLowerCase()
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

  useEffect(() => {
    if (timelineEnabled && !timelineDate && incidents.length > 0) {
      setTimelineDate(new Date(incidentDateRange.end.getFullYear(), incidentDateRange.end.getMonth(), 1))
    }
  }, [timelineEnabled, timelineDate, incidents.length, incidentDateRange.end])

  const filteredIncidents = useMemo(() => {
    if (!timelineEnabled || !timelineDate) return baseFilteredIncidents
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
  }, [baseFilteredIncidents, timelineEnabled, timelineDate, timelineWindowSize, incidentDateRange.start])

  // Sync filters to URL for shareable links
  useEffect(() => {
    const params = new URLSearchParams()
    if (currentTab) params.set('tab', currentTab)
    if (searchQuery) params.set('q', searchQuery)
    if (selectedCommunity) params.set('community', selectedCommunity)
    if (showHeatmap) params.set('heatmap', '1')
    setSearchParams(params, { replace: true })
  }, [currentTab, searchQuery, selectedCommunity, showHeatmap, setSearchParams])

  const toggleCategory = useCallback((category: CrimeCategory) => {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category]
    )
  }, [])

  const toggleYear = useCallback((year: number) => {
    setSelectedYears((current) =>
      current.includes(year)
        ? current.filter((y) => y !== year)
        : [...current, year]
    )
  }, [])

  const handleTimelineDisable = useCallback(() => {
    setTimelineEnabled(false)
    setTimelineDate(null)
  }, [])

  useEffect(() => {
    if (!selectedIncident) return
    const stillVisible = filteredIncidents.some((inc) => inc.id === selectedIncident.id)
    if (!stillVisible) setSelectedIncident(null)
  }, [filteredIncidents, selectedIncident])

  // Build legend items for active layers
  const legendItems = useMemo(() => {
    const items: Array<{ color: string; label: string }> = []

    if (showCrimeLayer && !showHeatmap) {
      selectedCategories.forEach((cat) => {
        items.push({ color: CRIME_CATEGORY_COLORS[cat], label: cat })
      })
    }
    if (showAirQualityLayer) {
      items.push({ color: '#22c55e', label: 'Air Quality Sensor' })
    }

    return items
  }, [showCrimeLayer, showHeatmap, selectedCategories, showAirQualityLayer])

  const selectedVariableLabel = useMemo(() => {
    if (!censusOverlay.selectedVariableId) return null
    return censusOverlay.variables.find((v) => v.id === censusOverlay.selectedVariableId)?.label ?? null
  }, [censusOverlay.variables, censusOverlay.selectedVariableId])
  const showLegend = (showCrimeLayer && showHeatmap)
    || legendItems.length > 0
    || (showCensusLayer && Boolean(selectedVariableLabel))

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((s) => !s)}
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">
            PG Data | {filteredIncidents.length.toLocaleString()} incidents
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {selectedIncident?.crimeType || selectedCommunity || `${selectedCategories.length} categories`}
          </div>
        </div>
      )}
      sidebar={
        <CrimeSidebar
          className="h-full w-full border-0 shadow-none md:w-[350px] md:border-r md:shadow-xl"
          incidents={incidents}
          filteredIncidents={filteredIncidents}
          selectedIncident={selectedIncident}
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
          onSelectAllYears={() => setSelectedYears(allYears)}
          onCommunityChange={setSelectedCommunity}
          onSearchChange={setSearchQuery}
          onToggleHeatmap={() => setShowHeatmap((h) => !h)}
          onToggleTimeline={() => setTimelineEnabled((t) => !t)}
          onIncidentClick={setSelectedIncident}
          onClearSelection={() => setSelectedIncident(null)}
          // Layers
          showCrimeLayer={showCrimeLayer}
          showAirQualityLayer={showAirQualityLayer}
          showCensusLayer={showCensusLayer}
          onToggleCrimeLayer={() => setShowCrimeLayer((v) => !v)}
          onToggleAirQualityLayer={() => setShowAirQualityLayer((v) => !v)}
          onToggleCensusLayer={() => setShowCensusLayer((v) => !v)}
          airMonitorCount={airOverlay.monitors.length}
          // Census
          censusCategories={censusOverlay.categories}
          censusVariables={censusOverlay.variables}
          selectedCensusCategoryId={censusOverlay.selectedCategoryId}
          selectedCensusVariableId={censusOverlay.selectedVariableId}
          onCensusCategoryChange={censusOverlay.setCategoryId}
          onCensusVariableChange={censusOverlay.setVariableId}
          censusLoading={censusOverlay.loading}
        />
      }
    >
      <div className="relative h-full">
        <CrimeMap
          incidents={filteredIncidents}
          selectedIncident={selectedIncident}
          showHeatmap={showHeatmap}
          onIncidentClick={setSelectedIncident}
          onIncidentClear={() => setSelectedIncident(null)}
          showCrimeLayer={showCrimeLayer}
          showAirQualityLayer={showAirQualityLayer}
          showCensusLayer={showCensusLayer}
          airMonitorGeojson={airOverlay.geojson}
          censusGeojson={censusOverlay.enrichedGeojson}
          censusFillColor={censusOverlay.fillColorExpression}
          loading={loading || (showAirQualityLayer && airOverlay.loading) || (showCensusLayer && censusOverlay.loading)}
        />

        {/* Timeline */}
        {timelineEnabled && !loading && timelineDate && (
          <Timeline
            startDate={incidentDateRange.start}
            endDate={incidentDateRange.end}
            currentDate={timelineDate}
            onDateChange={setTimelineDate}
            onClose={handleTimelineDisable}
            windowMode={{
              size: timelineWindowSize,
              onSizeChange: setTimelineWindowSize,
            }}
          />
        )}

        {/* Legend */}
        {showLegend && (
          <MapLegendPanel
            elevated={timelineEnabled}
            title={showCrimeLayer && showHeatmap ? 'Heatmap (Crime Density)' : 'Legend'}
            collapsible
          >
            {showCrimeLayer && showHeatmap ? (
              <MapGradientLegendItem colors={['#3b82f6', '#22c55e', '#eab308', '#ef4444']} minLabel="Low" maxLabel="High" />
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

                {/* Census choropleth legend */}
                {showCensusLayer && selectedVariableLabel && (
                  <MapLegendSection title={selectedVariableLabel}>
                    <MapGradientLegendItem
                      colors={[...COLOR_SCALES.purple]}
                      minLabel={censusOverlay.legendMin.toLocaleString()}
                      maxLabel={censusOverlay.legendMax.toLocaleString()}
                    />
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
