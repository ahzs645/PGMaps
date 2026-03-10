import { useEffect, useMemo, useState } from 'react'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { CensusMap } from './components/CensusMap'
import { CensusSidebar } from './components/CensusSidebar'
import { CENSUS_HIERARCHIES, CENSUS_METRICS } from './constants'
import { useCensusCatalog } from './hooks/useCensusCatalog'
import { useCensusData } from './hooks/useCensusData'
import { getVariableValues, useCensusVariableData } from './hooks/useCensusVariableData'
import type { CensusHierarchyLevel, CensusMetricKey, CensusVariableSelection } from './types'

const LEGEND_SWATCHES = ['#fef3c7', '#fde68a', '#fbbf24', '#f59e0b', '#b45309']

export default function CensusSection() {
  const { unitsByLevel, boundsByLevel, bounds, loading, error } = useCensusData()
  const { catalog } = useCensusCatalog()
  const [showSidebar, setShowSidebar] = useState(true)
  const [selectedHierarchy, setSelectedHierarchy] = useState<CensusHierarchyLevel>('da')
  const [selectedMetric, setSelectedMetric] = useState<CensusMetricKey>('populationDensity')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [variableSelection, setVariableSelection] = useState<CensusVariableSelection | null>(null)

  const { data: variableData, loading: variableLoading } = useCensusVariableData(
    selectedHierarchy,
    variableSelection?.categoryId ?? null
  )

  const allUnits = useMemo(() => unitsByLevel[selectedHierarchy], [selectedHierarchy, unitsByLevel])

  const availableMetrics = useMemo(() => {
    return CENSUS_METRICS.filter((metric) => metric.levels.includes(selectedHierarchy))
  }, [selectedHierarchy])

  // When a census variable is selected, compute its values by GeoUID
  const variableValuesByGeoUid = useMemo(() => {
    if (!variableSelection || !variableData) return null
    return getVariableValues(variableData, variableSelection.variableId)
  }, [variableData, variableSelection])

  // The active variable label for the legend
  const activeVariableLabel = useMemo(() => {
    if (!variableSelection || !catalog) return null
    const cat = catalog.categories.find((c) => c.id === variableSelection.categoryId)
    if (!cat) return null
    const variable = cat.variables.find((v) => v.id === variableSelection.variableId)
    return variable ? `${cat.name}: ${variable.label}` : null
  }, [catalog, variableSelection])

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
    if (activeVariableLabel) return activeVariableLabel
    return availableMetrics.find((item) => item.key === selectedMetric)?.label || 'Metric'
  }, [activeVariableLabel, availableMetrics, selectedMetric])

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
    if (selectedHierarchy === 'db') {
      setVariableSelection(null)
    }
  }, [selectedHierarchy])

  function handleMetricChange(metric: CensusMetricKey) {
    setSelectedMetric(metric)
    setVariableSelection(null)
  }

  function handleVariableSelect(categoryId: string, variableId: string) {
    setVariableSelection({ categoryId, variableId })
  }

  function handleClearVariable() {
    setVariableSelection(null)
  }

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
          catalog={catalog}
          variableSelection={variableSelection}
          variableLoading={variableLoading}
          variableValuesByGeoUid={variableValuesByGeoUid}
          onMetricChange={handleMetricChange}
          onHierarchyChange={setSelectedHierarchy}
          onSearchQueryChange={setSearchQuery}
          onUnitClick={(unit) => setSelectedUnitId(unit.id)}
          onClearSelection={() => setSelectedUnitId(null)}
          onVariableSelect={handleVariableSelect}
          onClearVariable={handleClearVariable}
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
          variableValuesByGeoUid={variableValuesByGeoUid}
        />

        <div className="absolute bottom-36 right-4 z-10 max-w-[220px] rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-6 md:right-6">
          <h4 className="mb-1 text-xs font-semibold text-foreground">{selectedHierarchyLabel}</h4>
          <h5 className="mb-2 line-clamp-2 text-xs text-muted-foreground">{selectedMetricLabel}</h5>
          {variableLoading && (
            <div className="mb-2 text-[10px] text-amber-600">Loading variable data...</div>
          )}
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
