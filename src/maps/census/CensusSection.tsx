import { useEffect, useMemo } from 'react'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { numberColumn, textColumn } from '@/components/map/tableColumns'
import { defineTableSource, useMapTable } from '@/components/map/useMapTable'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { useIsMobile } from '@/hooks/useIsMobile'
import { InlineAlert, MapGradientLegendItem, MapLegendPanel } from '@/components/ui/map-panels'
import { COLOR_SCALES } from '@/components/ui/map-styles'
import { formatNumber } from '@/lib/format'
import { geometryBounds, type BBox } from '@/lib/geo'
import { stringCodec, stringUnionCodec, useSetUrlParams, useUrlState, type UrlCodec } from '@/hooks/useUrlState'
import { CensusMap } from './components/CensusMap'
import { CensusSidebar } from './components/CensusSidebar'
import { CensusUnitDetails } from './components/CensusUnitDetails'
import { CENSUS_HIERARCHIES, CENSUS_METRICS, formatMetricValue, formatUnitLabel, formatValue } from './constants'
import { useCensusCatalog } from './hooks/useCensusCatalog'
import { useCensusData } from './hooks/useCensusData'
import { getVariableValues, useCensusVariableData } from './hooks/useCensusVariableData'
import type {
  CensusHierarchyLevel,
  CensusMetricKey,
  CensusMetricOption,
  CensusUnit,
  CensusVariableSelection,
} from './types'

const levelCodec = stringUnionCodec<CensusHierarchyLevel>(
  CENSUS_HIERARCHIES.map((option) => option.key),
  'da',
)
const metricCodec = stringUnionCodec<CensusMetricKey>(
  CENSUS_METRICS.map((metric) => metric.key),
  'populationDensity',
)
const queryCodec = stringCodec('')
/** Nullable id param: absent from the URL means nothing is selected. */
const idCodec: UrlCodec<string | null> = {
  encode: (value) => value,
  decode: (raw) => raw,
}

/** "Visible" reads these on every map move, so each unit's vertices are walked once. */
const unitBoundsCache = new WeakMap<CensusUnit, BBox | null>()
function unitBounds(unit: CensusUnit): BBox | null {
  let bounds = unitBoundsCache.get(unit)
  if (bounds === undefined) {
    bounds = geometryBounds(unit.geometry)
    unitBoundsCache.set(unit, bounds)
  }
  return bounds
}

const FIXED_UNIT_COLUMNS: Array<{ key: CensusMetricKey; header: string }> = [
  { key: 'population', header: 'Population' },
  { key: 'populationDensity', header: 'Density (/km²)' },
  { key: 'households', header: 'Households' },
  { key: 'dwellings', header: 'Dwellings' },
  { key: 'areaSqKm', header: 'Land area (km²)' },
]

/** The current metric or census variable comes first; a fixed column never repeats it. */
function unitColumns(
  metric: CensusMetricOption,
  variable: { label: string; values: Map<string, number | null> } | null,
) {
  const metricColumn = variable
    ? numberColumn<CensusUnit>('metric', variable.label, (unit) => variable.values.get(unit.id), {
        format: formatValue,
        width: 220,
      })
    : numberColumn<CensusUnit>('metric', metric.label, (unit) => unit[metric.key], {
        format: (value) => formatMetricValue(value, metric.format),
        width: 170,
      })
  return [
    textColumn<CensusUnit>('unit', 'Unit', formatUnitLabel, { width: 220 }),
    textColumn<CensusUnit>('id', 'GeoUID', (unit) => unit.id, { width: 130 }),
    metricColumn,
    ...FIXED_UNIT_COLUMNS.filter(({ key }) => variable || key !== metric.key).map(({ key, header }) =>
      numberColumn<CensusUnit>(key, header, (unit) => unit[key]),
    ),
  ]
}

export default function CensusSection() {
  const isMobileViewport = useIsMobile()
  const { catalog, loading: catalogLoading, error: catalogError } = useCensusCatalog()
  const [selectedHierarchy] = useUrlState('level', levelCodec)
  const { unitsByLevel, boundsByLevel, bounds, loading, error } = useCensusData([selectedHierarchy])
  const [selectedMetric, setSelectedMetric] = useUrlState('metric', metricCodec)
  const [searchQuery, setSearchQuery] = useUrlState('q', queryCodec)
  const [selectedUnitId, setSelectedUnitId] = useUrlState('unit', idCodec)
  const [selectedCategoryId] = useUrlState('category', idCodec)
  const [selectedVariableId] = useUrlState('variable', idCodec)
  const applyParams = useSetUrlParams()

  const variableSelection = useMemo<CensusVariableSelection | null>(
    () =>
      selectedCategoryId && selectedVariableId
        ? { categoryId: selectedCategoryId, variableId: selectedVariableId }
        : null,
    [selectedCategoryId, selectedVariableId],
  )

  const { data: variableData, loading: variableLoading } = useCensusVariableData(
    selectedHierarchy,
    variableSelection?.categoryId ?? null,
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
        unit.id.toLowerCase().includes(query) ||
        unit.name.toLowerCase().includes(query) ||
        (unit.parentCsdId || '').toLowerCase().includes(query) ||
        (unit.parentCtId || '').toLowerCase().includes(query)
      )
    })
  }, [allUnits, searchQuery])

  const selectedUnit = useMemo(() => {
    if (!selectedUnitId) return null
    return (
      filteredUnits.find((unit) => unit.id === selectedUnitId) ||
      allUnits.find((unit) => unit.id === selectedUnitId) ||
      null
    )
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
  }, [availableMetrics, selectedMetric, setSelectedMetric])

  const tableColumns = useMemo(
    () =>
      unitColumns(
        selectedMetricDef,
        variableValuesByGeoUid?.size && activeVariableLabel
          ? { label: activeVariableLabel, values: variableValuesByGeoUid }
          : null,
      ),
    [activeVariableLabel, selectedMetricDef, variableValuesByGeoUid],
  )
  const tableSources = useMemo(
    () => [
      defineTableSource<CensusUnit>({
        id: 'units',
        label: 'Census units',
        color: '#d97706',
        shape: 'fill',
        // The map draws every unit; the sidebar's search only narrows its own list.
        rows: allUnits,
        columns: tableColumns,
        getRowId: (unit) => unit.id,
        getRowBounds: unitBounds,
        status: loading ? 'loading' : error ? 'error' : 'ready',
        emptyMessage: error ?? 'No census units to show.',
        exportFileName: `census-${selectedHierarchy}`,
      }),
    ],
    [allUnits, error, loading, selectedHierarchy, tableColumns],
  )
  const table = useMapTable({
    sources: tableSources,
    selectedRowId: selectedUnitId,
    onSelectRow: (unit: CensusUnit) => setSelectedUnitId(unit.id),
    // CensusMap fits the selected unit, which also covers a click on the map.
    flyOnSelect: false,
  })

  function handleHierarchyChange(level: CensusHierarchyLevel) {
    if (level === selectedHierarchy) return
    applyParams({
      level: levelCodec.encode(level),
      unit: null,
      ...(level === 'db' ? { category: null, variable: null } : {}),
    })
  }

  function handleMetricChange(metric: CensusMetricKey) {
    applyParams({
      metric: metricCodec.encode(metric),
      category: null,
      variable: null,
    })
  }

  function handleVariableSelect(categoryId: string, variableId: string) {
    applyParams({ category: categoryId, variable: variableId })
  }

  function handleClearVariable() {
    applyParams({ category: null, variable: null })
  }

  return (
    <MapSectionLayout
      table={table}
      mobilePeekTitle={<>Census · {formatNumber(filteredUnits.length)} units</>}
      mobilePeekSubtitle={
        <>
          {selectedHierarchyLabel} · {selectedUnit?.name || selectedMetricLabel}
        </>
      }
      sidebar={
        <CensusSidebar
          className={MAP_SIDEBAR_CLASS}
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
          catalogLoading={catalogLoading}
          catalogError={catalogError}
          variableSelection={variableSelection}
          variableLoading={variableLoading}
          variableValuesByGeoUid={variableValuesByGeoUid}
          onMetricChange={handleMetricChange}
          onHierarchyChange={handleHierarchyChange}
          onSearchQueryChange={setSearchQuery}
          onUnitClick={(unit) => setSelectedUnitId(unit.id)}
          onClearSelection={() => setSelectedUnitId(null)}
          onVariableSelect={handleVariableSelect}
          onClearVariable={handleClearVariable}
        />
      }
    >
      <div className="relative h-full">
        <CensusMap
          units={allUnits}
          selectedMetric={selectedMetric}
          selectedUnitId={selectedUnitId}
          bounds={boundsByLevel[selectedHierarchy] || bounds}
          onUnitClick={(id) => setSelectedUnitId(selectedUnitId === id ? null : id)}
          variableValuesByGeoUid={variableValuesByGeoUid}
          loading={loading || variableLoading}
          table={table}
        />

        <MapLegendPanel
          width="sm"
          title={selectedHierarchyLabel}
          description={selectedMetricLabel}
          collapsible
          defaultCollapsed="mobile"
        >
          {variableLoading && (
            <InlineAlert loading className="mb-2">
              Loading variable data...
            </InlineAlert>
          )}
          <MapGradientLegendItem colors={COLOR_SCALES.amber} minLabel="Low" maxLabel="High" />
        </MapLegendPanel>

        {isMobileViewport && selectedUnit && (
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
    <MobileFeatureCard cardKey={unit.id} title={formatUnitLabel(unit)} subtitle={hierarchyLabel} onClose={onClose}>
      <CensusUnitDetails
        unit={unit}
        isVariableMode={isVariableMode}
        metricLabel={metricLabel}
        metricValue={metricValue}
        variableCategoryName={variableCategoryName}
        variableLabel={variableLabel}
        variableValue={variableValue}
      />
    </MobileFeatureCard>
  )
}
