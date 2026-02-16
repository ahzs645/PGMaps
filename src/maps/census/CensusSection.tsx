import { useEffect, useMemo, useState } from 'react'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { CensusMap } from './components/CensusMap'
import { CensusSidebar } from './components/CensusSidebar'
import { CENSUS_HIERARCHIES, CENSUS_METRICS } from './constants'
import { useCensusData } from './hooks/useCensusData'
import type { CensusHierarchyLevel, CensusMetricKey } from './types'

const LEGEND_SWATCHES = ['#fef3c7', '#fde68a', '#fbbf24', '#f59e0b', '#b45309']

export default function CensusSection() {
  const { unitsByLevel, boundsByLevel, bounds, loading, error } = useCensusData()
  const [showSidebar, setShowSidebar] = useState(true)
  const [selectedHierarchy, setSelectedHierarchy] = useState<CensusHierarchyLevel>('da')
  const [selectedMetric, setSelectedMetric] = useState<CensusMetricKey>('populationDensity')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)

  const allUnits = useMemo(() => unitsByLevel[selectedHierarchy], [selectedHierarchy, unitsByLevel])

  const availableMetrics = useMemo(() => {
    return CENSUS_METRICS.filter((metric) => metric.levels.includes(selectedHierarchy))
  }, [selectedHierarchy])

  const filteredUnits = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return allUnits
    return allUnits.filter((unit) => {
      return (
        unit.id.toLowerCase().includes(query)
        || unit.name.toLowerCase().includes(query)
        || (unit.parentCsdId || '').toLowerCase().includes(query)
        || (unit.parentCtId || '').toLowerCase().includes(query)
      )
    })
  }, [allUnits, searchQuery])

  const selectedUnit = useMemo(() => {
    if (!selectedUnitId) return null
    return filteredUnits.find((unit) => unit.id === selectedUnitId)
      || allUnits.find((unit) => unit.id === selectedUnitId)
      || null
  }, [allUnits, filteredUnits, selectedUnitId])

  const selectedMetricLabel = useMemo(() => {
    return availableMetrics.find((item) => item.key === selectedMetric)?.label || 'Metric'
  }, [availableMetrics, selectedMetric])

  const selectedHierarchyLabel = useMemo(() => {
    return CENSUS_HIERARCHIES.find((item) => item.key === selectedHierarchy)?.label || 'Hierarchy'
  }, [selectedHierarchy])

  useEffect(() => {
    if (!availableMetrics.length) return
    const currentSupported = availableMetrics.some((item) => item.key === selectedMetric)
    if (!currentSupported) {
      setSelectedMetric(availableMetrics[0].key)
    }
  }, [availableMetrics, selectedMetric])

  useEffect(() => {
    setSelectedUnitId(null)
  }, [selectedHierarchy])

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      sidebar={(
        <CensusSidebar
          className="h-full w-full border-0 shadow-none md:w-[350px] md:border-r md:shadow-xl"
          units={allUnits}
          filteredUnits={filteredUnits}
          selectedUnit={selectedUnit}
          selectedMetric={selectedMetric}
          selectedHierarchy={selectedHierarchy}
          availableMetrics={availableMetrics}
          searchQuery={searchQuery}
          loading={loading}
          error={error}
          onMetricChange={setSelectedMetric}
          onHierarchyChange={setSelectedHierarchy}
          onSearchQueryChange={setSearchQuery}
          onUnitClick={(unit) => setSelectedUnitId(unit.id)}
          onClearSelection={() => setSelectedUnitId(null)}
        />
      )}
    >
      <div className="relative h-full">
        <CensusMap
          units={allUnits}
          selectedMetric={selectedMetric}
          selectedUnitId={selectedUnitId}
          bounds={boundsByLevel[selectedHierarchy] || bounds}
          onUnitClick={(id) => setSelectedUnitId(id)}
        />

        <div className="absolute bottom-36 right-4 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-6 md:right-6">
          <h4 className="mb-1 text-xs font-semibold text-foreground">{selectedHierarchyLabel}</h4>
          <h5 className="mb-2 text-xs text-muted-foreground">{selectedMetricLabel}</h5>
          <div className="flex items-center gap-1.5">
            {LEGEND_SWATCHES.map((color) => (
              <span
                key={color}
                className="h-3 w-6 rounded-sm border border-black/10 dark:border-white/10"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>
      </div>
    </MapSectionLayout>
  )
}
