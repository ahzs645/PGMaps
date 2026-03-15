import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { COLOR_SCALES } from '@/components/ui/map-styles'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { CrimeMap } from './components/CrimeMap'
import { CrimeSidebar } from './components/CrimeSidebar'
import { CrimeTimeline, type TimelineRange } from './components/CrimeTimeline'
import { getCrimeCategory, CRIME_CATEGORY_COLORS } from './constants'
import { useCrimeData } from './hooks/useCrimeData'
import { useAirMonitorOverlay } from './hooks/useAirMonitorOverlay'
import { useCensusOverlay } from './hooks/useCensusOverlay'
import type { CrimeIncident, CrimeCategory } from './types'

const ALL_CATEGORIES = Object.keys(CRIME_CATEGORY_COLORS) as CrimeCategory[]

export default function PGDataSection() {
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
  const [selectedCommunity, setSelectedCommunity] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [selectedIncident, setSelectedIncident] = useState<CrimeIncident | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineRange, setTimelineRange] = useState<TimelineRange | null>(null)

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

  const filteredIncidents = useMemo(() => {
    if (!timelineEnabled || !timelineRange) return baseFilteredIncidents
    const { start, end } = timelineRange
    return baseFilteredIncidents.filter((inc) => {
      const t = inc.date.getTime()
      return t >= start.getTime() && t <= end.getTime()
    })
  }, [baseFilteredIncidents, timelineEnabled, timelineRange])

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

  const handleTimelineChange = useCallback((range: TimelineRange) => {
    setTimelineRange(range)
  }, [])

  const handleTimelineDisable = useCallback(() => {
    setTimelineEnabled(false)
    setTimelineRange(null)
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

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((s) => !s)}
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
        />

        {/* Timeline */}
        {timelineEnabled && !loading && (
          <CrimeTimeline
            incidents={baseFilteredIncidents}
            onChange={handleTimelineChange}
            onDisable={handleTimelineDisable}
          />
        )}

        {/* Legend */}
        <div
          className={cn(
            'absolute right-4 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:right-6',
            timelineEnabled ? 'bottom-40 md:bottom-28' : 'bottom-36 md:bottom-6'
          )}
        >
          {showCrimeLayer && showHeatmap ? (
            <>
              <h4 className="mb-2 text-xs font-semibold text-foreground">Heatmap (Crime Density)</h4>
              <div className="space-y-1">
                <div className="h-2 w-40 rounded bg-gradient-to-r from-blue-500 via-green-500 via-40% via-yellow-500 via-60% to-red-500" />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Low</span>
                  <span>High</span>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              {/* Point legends */}
              {legendItems.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold text-foreground">Layers</h4>
                  <div className="space-y-1">
                    {legendItems.map((item) => (
                      <div key={item.label} className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-xs text-muted-foreground">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Census choropleth legend */}
              {showCensusLayer && selectedVariableLabel && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold text-foreground">
                    {selectedVariableLabel}
                  </h4>
                  <div className="flex h-2 w-40 overflow-hidden rounded">
                    {COLOR_SCALES.purple.map((color) => (
                      <div key={color} className="flex-1" style={{ backgroundColor: color }} />
                    ))}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{censusOverlay.legendMin.toLocaleString()}</span>
                    <span>{censusOverlay.legendMax.toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </MapSectionLayout>
  )
}
