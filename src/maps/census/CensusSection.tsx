import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { MapGradientLegendItem, MapLegendPanel } from '@/components/ui/map-panels'
import { CensusMap } from './components/CensusMap'
import { CensusSidebar, formatArea, formatUnitLabel, formatValue } from './components/CensusSidebar'
import { CENSUS_HIERARCHIES, CENSUS_METRICS, formatMetricValue } from './constants'
import { useCensusCatalog } from './hooks/useCensusCatalog'
import { useCensusData } from './hooks/useCensusData'
import { getVariableValues, useCensusVariableData } from './hooks/useCensusVariableData'
import type { CensusHierarchyLevel, CensusMetricKey, CensusUnit, CensusVariableSelection } from './types'

const LEGEND_SWATCHES = ['#fef3c7', '#fde68a', '#fbbf24', '#f59e0b', '#b45309']

export default function CensusSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { unitsByLevel, boundsByLevel, bounds, loading, error } = useCensusData()
  const { catalog } = useCensusCatalog()
  const [showSidebar, setShowSidebar] = useState(true)
  const [selectedHierarchy, setSelectedHierarchy] = useState<CensusHierarchyLevel>(() => (searchParams.get('level') as CensusHierarchyLevel) || 'da')
  const [selectedMetric, setSelectedMetric] = useState<CensusMetricKey>(() => (searchParams.get('metric') as CensusMetricKey) || 'populationDensity')
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(() => searchParams.get('unit'))
  const previousHierarchyRef = useRef(selectedHierarchy)
  const [variableSelection, setVariableSelection] = useState<CensusVariableSelection | null>(() => {
    const categoryId = searchParams.get('category')
    const variableId = searchParams.get('variable')
    return categoryId && variableId ? { categoryId, variableId } : null
  })

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

  const selectedMetricDef = useMemo(
    () => availableMetrics.find((metric) => metric.key === selectedMetric) || availableMetrics[0] || CENSUS_METRICS[0],
    [availableMetrics, selectedMetric],
  )

  const activeCategoryName = useMemo(() => {
    if (!variableSelection || !catalog) return null
    return catalog.categories.find((category) => category.id === variableSelection.categoryId)?.name || null
  }, [catalog, variableSelection])

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
    if (previousHierarchyRef.current === selectedHierarchy) {
      return
    }
    previousHierarchyRef.current = selectedHierarchy
    setSelectedUnitId(null)
    if (selectedHierarchy === 'db') {
      setVariableSelection(null)
    }
  }, [selectedHierarchy])

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    params.set('level', selectedHierarchy)
    if (selectedMetric !== 'populationDensity') params.set('metric', selectedMetric)
    else params.delete('metric')
    if (searchQuery.trim()) params.set('q', searchQuery.trim())
    else params.delete('q')
    if (selectedUnitId) params.set('unit', selectedUnitId)
    else params.delete('unit')
    if (variableSelection) {
      params.set('category', variableSelection.categoryId)
      params.set('variable', variableSelection.variableId)
    } else {
      params.delete('category')
      params.delete('variable')
    }
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [searchParams, searchQuery, selectedHierarchy, selectedMetric, selectedUnitId, setSearchParams, variableSelection])

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
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">
            Census | {filteredUnits.length.toLocaleString()} units
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {selectedHierarchyLabel} | {selectedUnit?.name || selectedMetricLabel}
          </div>
        </div>
      )}
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
          loading={loading || variableLoading}
        />

        <MapLegendPanel
          className="max-w-[220px]"
          title={selectedHierarchyLabel}
          description={selectedMetricLabel}
          collapsible
        >
          {variableLoading && (
            <div className="mb-2 text-[10px] text-amber-600">Loading variable data...</div>
          )}
          <MapGradientLegendItem colors={LEGEND_SWATCHES} minLabel="Low" maxLabel="High" />
        </MapLegendPanel>

        {selectedUnit && (
          <MobileCensusFeatureCard
            unit={selectedUnit}
            hierarchyLabel={selectedHierarchyLabel}
            metricLabel={selectedMetricDef.label}
            metricValue={formatMetricValue(selectedUnit[selectedMetric], selectedMetricDef.format)}
            variableCategoryName={activeCategoryName}
            variableLabel={activeVariableLabel}
            variableValue={variableValuesByGeoUid?.get(selectedUnit.id) ?? null}
            isVariableMode={variableSelection != null}
            onClose={() => setSelectedUnitId(null)}
          />
        )}
      </div>
    </MapSectionLayout>
  )
}

function MobileCensusFeatureCard({
  unit,
  hierarchyLabel,
  metricLabel,
  metricValue,
  variableCategoryName,
  variableLabel,
  variableValue,
  isVariableMode,
  onClose,
}: {
  unit: CensusUnit
  hierarchyLabel: string
  metricLabel: string
  metricValue: string
  variableCategoryName: string | null
  variableLabel: string | null
  variableValue: number | null
  isVariableMode: boolean
  onClose: () => void
}) {
  return (
    <MobileFeatureCard
      title={formatUnitLabel(unit)}
      subtitle={hierarchyLabel}
      onClose={onClose}
    >
      {isVariableMode ? (
        <div>
          <div className="text-[10px] text-amber-700 dark:text-amber-300">{variableCategoryName}</div>
          <div className="text-2xl font-bold text-amber-800 dark:text-amber-200">
            {formatValue(variableValue)}
          </div>
          <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{variableLabel}</div>
        </div>
      ) : (
        <div>
          <div className="text-2xl font-bold text-amber-800 dark:text-amber-200">
            {metricValue}
          </div>
          <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{metricLabel}</div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-300">
        <div>Area: {formatArea(unit.areaSqKm || 0)} km²</div>
        <div>Pop: {(unit.population || 0).toLocaleString()}</div>
        <div>Households: {(unit.households || 0).toLocaleString()}</div>
        <div>Dwellings: {(unit.dwellings || 0).toLocaleString()}</div>
        <div>DA count: {unit.daCount.toLocaleString()}</div>
        <div>DB count: {unit.dbCount.toLocaleString()}</div>
      </div>
    </MobileFeatureCard>
  )
}
