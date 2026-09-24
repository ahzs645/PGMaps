import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, X } from 'lucide-react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { AppSelect } from '@/components/ui/select'
import {
  InlineAlert,
  MapSidebarShell,
  SearchInput,
  SelectedItemCard,
  SidebarSection,
  StatGrid,
} from '@/components/ui/map-panels'
import { ListState, ResultRow } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StickyListToolbar, useRevealBelowSticky } from '@/components/ui/sticky-list-toolbar'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { DATASETS } from '@/lib/dataCatalog'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  CENSUS_HIERARCHIES,
  CENSUS_METRICS,
  formatAreaSqKm,
  formatMetricValue,
  formatUnitLabel,
  formatValue,
} from '../constants'
import { CensusUnitDetails } from './CensusUnitDetails'
import type {
  CensusCatalog,
  CensusHierarchyLevel,
  CensusMetricKey,
  CensusMetricOption,
  CensusUnit,
  CensusVariableSelection,
} from '../types'

interface CensusSidebarProps {
  className?: string
  units: CensusUnit[]
  filteredUnits: CensusUnit[]
  selectedUnit: CensusUnit | null
  selectedMetric: CensusMetricKey
  selectedHierarchy: CensusHierarchyLevel
  availableMetrics: CensusMetricOption[]
  searchQuery: string
  loading: boolean
  error: string | null
  catalog: CensusCatalog | null
  catalogLoading: boolean
  catalogError: string | null
  variableSelection: CensusVariableSelection | null
  variableLoading: boolean
  variableValuesByGeoUid: Map<string, number | null> | null
  onMetricChange: (metric: CensusMetricKey) => void
  onHierarchyChange: (level: CensusHierarchyLevel) => void
  onSearchQueryChange: (query: string) => void
  onUnitClick: (unit: CensusUnit) => void
  onClearSelection: () => void
  onVariableSelect: (categoryId: string, variableId: string) => void
  onClearVariable: () => void
}

type VariableTypeFilter = 'Total' | 'Male' | 'Female' | 'all'

const VARIABLE_TYPE_OPTIONS = [
  { value: 'Total', label: 'Total' },
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'all', label: 'All' },
] as const

export function CensusSidebar({
  className,
  units,
  filteredUnits,
  selectedUnit,
  selectedMetric,
  selectedHierarchy,
  availableMetrics,
  searchQuery,
  loading,
  error,
  catalog,
  catalogLoading,
  catalogError,
  variableSelection,
  variableLoading,
  variableValuesByGeoUid,
  onMetricChange,
  onHierarchyChange,
  onSearchQueryChange,
  onUnitClick,
  onClearSelection,
  onVariableSelect,
  onClearVariable,
}: CensusSidebarProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [variableSearch, setVariableSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<VariableTypeFilter>('Total')
  const [showVariableBrowser, setShowVariableBrowser] = useState(false)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const selectedCardRef = useRef<HTMLDivElement>(null)

  const selectedMetricDef = useMemo(
    () => availableMetrics.find((metric) => metric.key === selectedMetric) || availableMetrics[0] || CENSUS_METRICS[0],
    [availableMetrics, selectedMetric],
  )
  const selectedHierarchyDef = useMemo(
    () => CENSUS_HIERARCHIES.find((level) => level.key === selectedHierarchy) || CENSUS_HIERARCHIES[0],
    [selectedHierarchy],
  )

  const selectedCategory = useMemo(() => {
    if (!catalog || !selectedCategoryId) return null
    return catalog.categories.find((c) => c.id === selectedCategoryId) || null
  }, [catalog, selectedCategoryId])

  const filteredVariables = useMemo(() => {
    if (!selectedCategory) return []
    let vars = selectedCategory.variables
    if (typeFilter !== 'all') {
      vars = vars.filter((v) => v.type === typeFilter)
    }
    const query = variableSearch.trim().toLowerCase()
    if (query) {
      vars = vars.filter((v) => v.label.toLowerCase().includes(query) || v.id.toLowerCase().includes(query))
    }
    return vars
  }, [selectedCategory, typeFilter, variableSearch])

  // Get the active variable's value for a unit
  function getUnitVariableValue(unit: CensusUnit): number | null {
    if (!variableValuesByGeoUid) return null
    return variableValuesByGeoUid.get(unit.id) ?? null
  }

  const isVariableMode = variableSelection != null

  const totals = useMemo(() => {
    let population = 0
    let areaSqKm = 0
    filteredUnits.forEach((unit) => {
      population += unit.population || 0
      areaSqKm += unit.areaSqKm || 0
    })
    return { population, areaSqKm }
  }, [filteredUnits])

  const sortedUnits = useMemo(() => {
    return [...filteredUnits].sort((a, b) => {
      if (isVariableMode && variableValuesByGeoUid) {
        const av = variableValuesByGeoUid.get(a.id) ?? null
        const bv = variableValuesByGeoUid.get(b.id) ?? null
        if (av == null && bv == null) return a.id.localeCompare(b.id)
        if (av == null) return 1
        if (bv == null) return -1
        return bv - av
      }
      const av = a[selectedMetric]
      const bv = b[selectedMetric]
      if (av == null && bv == null) return a.id.localeCompare(b.id)
      if (av == null) return 1
      if (bv == null) return -1
      return bv - av
    })
  }, [filteredUnits, isVariableMode, selectedMetric, variableValuesByGeoUid])

  const activeVariableLabel = useMemo(() => {
    if (!variableSelection || !catalog) return null
    const cat = catalog.categories.find((c) => c.id === variableSelection.categoryId)
    if (!cat) return null
    const v = cat.variables.find((v) => v.id === variableSelection.variableId)
    return v ? v.label : null
  }, [catalog, variableSelection])

  const activeCategoryName = useMemo(() => {
    if (!variableSelection || !catalog) return null
    return catalog.categories.find((c) => c.id === variableSelection.categoryId)?.name || null
  }, [catalog, variableSelection])

  // Group categories by their group (Basic, 100% Data, 25% Data)
  const categoryGroups = useMemo(() => {
    if (!catalog) return []
    const groups = new Map<string, typeof catalog.categories>()
    for (const cat of catalog.categories) {
      const existing = groups.get(cat.group) || []
      existing.push(cat)
      groups.set(cat.group, existing)
    }
    return Array.from(groups.entries()).map(([name, cats]) => ({ name, categories: cats }))
  }, [catalog])

  const rankLabel = isVariableMode ? activeVariableLabel || 'variable' : selectedMetricDef.label.toLowerCase()

  // Selecting a unit on the map inserts its card above the list, out of view
  // if the list was scrolled. Bring it in under the toolbar.
  useRevealBelowSticky(toolbarRef, selectedCardRef, selectedUnit?.id)

  return (
    <MapSidebarShell
      className={className}
      title="Census Data Explorer"
      subtitle={
        catalog
          ? `${formatNumber(catalog.totalVariables)} variables across 5 geographic levels`
          : catalogLoading
            ? 'Loading catalog... across 5 geographic levels'
            : 'Census patterns across 5 geographic levels'
      }
      dataset={DATASETS.census}
    >
      <StudyAreaSelector<string, CensusHierarchyLevel>
        level={selectedHierarchy}
        levelOptions={CENSUS_HIERARCHIES.map((level) => ({ value: level.key, label: level.label }))}
        // Clearing the selected unit on level change is handled atomically by
        // onHierarchyChange so the two URL updates land in a single write.
        onLevelChange={onHierarchyChange}
        levelSelectId="census-study-area-level"
      />

      {/* Level & Metric selectors */}
      <div className="border-b border-border bg-background/95 px-4 py-3">
        <div className="mb-2 text-xs text-muted-foreground">
          {formatNumber(filteredUnits.length)} of {formatNumber(units.length)} units
        </div>
        <div className="space-y-2">
          <AppSelect
            value={isVariableMode ? '__variable__' : selectedMetric}
            onValueChange={(val) => {
              if (val === '__variable__') return
              onMetricChange(val as CensusMetricKey)
            }}
            options={[
              ...availableMetrics.map((metric) => ({ value: metric.key, label: metric.label })),
              ...(isVariableMode
                ? [{ value: '__variable__', label: `Variable: ${activeVariableLabel}`, disabled: true }]
                : []),
            ]}
            triggerClassName="h-10 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
          />
        </div>
      </div>

      {/* Variable browser toggle & active variable display */}
      <div className="border-b border-border bg-background/95 px-4 py-3">
        {selectedHierarchy === 'db' ? (
          <InlineAlert>
            Census variables are suppressed at DB level for privacy. Use DA or higher for detailed variable data.
          </InlineAlert>
        ) : (
          <>
            {isVariableMode && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 dark:border-amber-800/60 dark:bg-amber-950/25">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-amber-700 dark:text-amber-300">{activeCategoryName}</div>
                  <div className="truncate text-xs font-semibold text-amber-900 dark:text-amber-200">
                    {activeVariableLabel}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClearVariable}
                  className="shrink-0 rounded p-0.5 text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 touch:p-2"
                  aria-label="Clear variable selection"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
            {catalog ? (
              <button
                type="button"
                onClick={() => setShowVariableBrowser((v) => !v)}
                aria-expanded={showVariableBrowser}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  showVariableBrowser
                    ? 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
                    : 'border-input bg-background text-foreground hover:bg-accent',
                )}
              >
                {showVariableBrowser ? 'Hide Variable Browser' : 'Browse Census Variables...'}
              </button>
            ) : catalogLoading ? (
              <InlineAlert loading>Loading census variable catalog...</InlineAlert>
            ) : (
              <InlineAlert tone={catalogError ? 'warning' : 'info'}>
                {catalogError || 'Census variable catalog is not available.'} Core metrics above still work.
              </InlineAlert>
            )}
          </>
        )}
      </div>

      {/* Variable browser panel */}
      {showVariableBrowser && catalog && selectedHierarchy !== 'db' && (
        <div className="border-b border-border bg-muted/30">
          {!selectedCategoryId ? (
            // Category list
            <div>
              {categoryGroups.map((group) => (
                <div key={group.name}>
                  <div className="sticky top-0 z-10 bg-muted/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                    {group.name}
                  </div>
                  {group.categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategoryId(cat.id)
                        setVariableSearch('')
                      }}
                      className={cn(
                        'w-full px-4 py-2.5 text-left transition-colors hover:bg-accent',
                        variableSelection?.categoryId === cat.id && 'bg-amber-50 dark:bg-amber-950/30',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{cat.name}</span>
                        <span className="text-xs text-muted-foreground">{cat.variableCount}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            // Variable list within selected category
            <div>
              <div className="border-b border-border px-4 py-2">
                <div className="mb-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedCategoryId(null)}
                    className="rounded p-0.5 text-sm text-muted-foreground hover:text-foreground touch:p-2"
                    aria-label="Back to category list"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <span className="text-sm font-semibold text-foreground">{selectedCategory?.name}</span>
                  <span className="text-xs text-muted-foreground">({filteredVariables.length})</span>
                </div>
                <SearchInput
                  value={variableSearch}
                  onChange={(e) => setVariableSearch(e.target.value)}
                  onClear={() => setVariableSearch('')}
                  icon
                  placeholder="Search variables..."
                  aria-label="Search variables"
                  // The toolbar's unit search stays the target of the map's search shortcut.
                  data-map-search-input="false"
                  wrapperClassName="mb-2"
                  className="focus:ring-amber-500"
                />
                <SegmentedControl
                  label="Variable type"
                  size="sm"
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={VARIABLE_TYPE_OPTIONS}
                />
              </div>
              <div>
                {variableLoading && <div className="px-4 py-2 text-xs text-muted-foreground">Loading data...</div>}
                {filteredVariables.map((v) => {
                  const isActive = variableSelection?.variableId === v.id
                  return (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        onVariableSelect(selectedCategoryId!, v.id)
                      }}
                      className={cn(
                        'w-full px-4 py-2 text-left text-xs transition-colors hover:bg-accent',
                        isActive && 'bg-amber-50 font-medium dark:bg-amber-950/30',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-foreground">{v.label}</span>
                        {v.type && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {v.type}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{v.id}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary stats */}
      <SidebarSection className="px-4 py-3">
        <StatGrid
          stats={[
            { label: 'units', value: formatNumber(filteredUnits.length), valueClassName: 'text-base' },
            { label: 'population', value: formatNumber(totals.population), valueClassName: 'text-base' },
            { label: 'km² area', value: formatAreaSqKm(totals.areaSqKm), valueClassName: 'text-base' },
          ]}
        />
      </SidebarSection>

      {/* Search stays reachable while the unit list scrolls. */}
      <StickyListToolbar
        ref={toolbarRef}
        search={
          <SearchInput
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onClear={() => onSearchQueryChange('')}
            icon
            placeholder={`Search ${selectedHierarchyDef.label}...`}
            aria-label={`Search ${selectedHierarchyDef.label}`}
            className="focus:ring-amber-500"
          />
        }
        count={
          !loading && !error ? (
            <>
              {formatNumber(sortedUnits.length)} {sortedUnits.length === 1 ? 'unit' : 'units'} · top by {rankLabel}
            </>
          ) : undefined
        }
      />

      {/* Selected unit detail */}
      {selectedUnit && (
        <div ref={selectedCardRef}>
          <SidebarSection>
            <SelectedItemCard
              tone="amber"
              title={formatUnitLabel(selectedUnit)}
              subtitle={selectedHierarchyDef.label}
              onClear={onClearSelection}
              clearLabel="Clear selected unit"
            >
              <CensusUnitDetails
                className="mt-2"
                unit={selectedUnit}
                isVariableMode={isVariableMode}
                metricLabel={selectedMetricDef.label}
                metricValue={formatMetricValue(selectedUnit[selectedMetric], selectedMetricDef.format)}
                variableCategoryName={activeCategoryName}
                variableLabel={activeVariableLabel}
                variableValue={getUnitVariableValue(selectedUnit)}
              />
            </SelectedItemCard>
          </SidebarSection>
        </div>
      )}

      {/* Unit list */}
      <ListState
        loading={loading}
        loadingLabel="Loading census data..."
        error={error}
        errorTitle="Error loading census data"
        empty={sortedUnits.length === 0}
        emptyLabel="No units match this search."
        onReset={searchQuery ? () => onSearchQueryChange('') : undefined}
        resetLabel="Clear search"
      >
        <VirtualResultList
          items={sortedUnits}
          getKey={(unit) => `${unit.level}-${unit.id}`}
          estimateSize={64}
          label="Census units"
        >
          {(unit) => (
            <ResultRow
              accent="amber"
              selected={selectedUnit?.id === unit.id}
              onClick={() => onUnitClick(unit)}
              title={formatUnitLabel(unit)}
              subtitle={`Area ${formatAreaSqKm(unit.areaSqKm)} km² · DA ${formatNumber(unit.daCount)} · DB ${formatNumber(unit.dbCount)}`}
              trailing={
                <span className="text-amber-600 dark:text-amber-400">
                  {isVariableMode
                    ? formatValue(getUnitVariableValue(unit))
                    : formatMetricValue(unit[selectedMetric], selectedMetricDef.format)}
                </span>
              }
            />
          )}
        </VirtualResultList>
      </ListState>
    </MapSidebarShell>
  )
}
