import { useMemo, useState } from 'react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { AppSelect } from '@/components/ui/select'
import { MapSidebarShell, SearchInput, SelectedItemCard, SidebarSection, StatGrid } from '@/components/ui/map-panels'
import { DATASETS } from '@/lib/dataCatalog'
import { cn } from '@/lib/utils'
import { CENSUS_HIERARCHIES, CENSUS_METRICS, formatMetricValue } from '../constants'
import type {
  CensusCatalog,
  CensusHierarchyLevel,
  CensusMetricKey,
  CensusMetricOption,
  CensusUnit,
  CensusVariableSelection,
} from '../types'
import { DEFAULT_LOCALE } from '@/lib/format'

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

const MAX_ROWS = 140

export function formatUnitLabel(unit: CensusUnit): string {
  switch (unit.level) {
    case 'cd':
      return `CD ${unit.id}`
    case 'csd':
      return `${unit.name} (${unit.id})`
    case 'ct':
      return `CT ${unit.name}`
    case 'da':
      return `DA ${unit.id}`
    case 'db':
      return `DB ${unit.id}`
    default:
      return unit.id
  }
}

export function formatArea(value: number): string {
  return value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 1 })
}

export function formatValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'N/A'
  if (Number.isInteger(value)) return value.toLocaleString()
  return value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 2 })
}

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
  const [typeFilter, setTypeFilter] = useState<'Total' | 'Male' | 'Female' | 'all'>('Total')
  const [showVariableBrowser, setShowVariableBrowser] = useState(false)

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
    const sorted = [...filteredUnits].sort((a, b) => {
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
    return sorted.slice(0, MAX_ROWS)
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

  return (
    <MapSidebarShell
      className={className}
      title="Census Data Explorer"
      subtitle={
        catalog
          ? `${catalog.totalVariables.toLocaleString()} variables across 5 geographic levels`
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
          {filteredUnits.length} of {units.length} units
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
          <div className="rounded-lg border border-muted bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Census variables are suppressed at DB level for privacy. Use DA or higher for detailed variable data.
          </div>
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
                  onClick={onClearVariable}
                  className="shrink-0 text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
                  aria-label="Clear variable selection"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            {catalog ? (
              <button
                onClick={() => setShowVariableBrowser((v) => !v)}
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
              <div className="rounded-lg border border-muted bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Loading census variable catalog...
              </div>
            ) : (
              <div className="rounded-lg border border-muted bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {catalogError || 'Census variable catalog is not available.'} Core metrics above still work.
              </div>
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
                    onClick={() => setSelectedCategoryId(null)}
                    className="text-sm text-muted-foreground hover:text-foreground"
                    aria-label="Back to category list"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="text-sm font-semibold text-foreground">{selectedCategory?.name}</span>
                  <span className="text-xs text-muted-foreground">({filteredVariables.length})</span>
                </div>
                <input
                  type="text"
                  value={variableSearch}
                  onChange={(e) => setVariableSearch(e.target.value)}
                  placeholder="Search variables..."
                  className="mb-2 w-full rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <div className="flex gap-1">
                  {(['Total', 'Male', 'Female', 'all'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(t)}
                      className={cn(
                        'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                        typeFilter === t ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {t === 'all' ? 'All' : t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                {variableLoading && <div className="px-4 py-2 text-xs text-muted-foreground">Loading data...</div>}
                {filteredVariables.map((v) => {
                  const isActive = variableSelection?.variableId === v.id
                  return (
                    <button
                      key={v.id}
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

      {/* Search */}
      <SidebarSection>
        <SearchInput
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={`Search ${selectedHierarchyDef.label}...`}
          className="focus:ring-amber-500"
        />
      </SidebarSection>

      {/* Summary stats */}
      <SidebarSection className="px-4 py-3">
        <StatGrid
          stats={[
            { label: 'units', value: filteredUnits.length.toLocaleString(), valueClassName: 'text-base' },
            { label: 'population', value: totals.population.toLocaleString(), valueClassName: 'text-base' },
            { label: 'km² area', value: formatArea(totals.areaSqKm), valueClassName: 'text-base' },
          ]}
        />
      </SidebarSection>

      {/* Selected unit detail */}
      {selectedUnit && (
        <SidebarSection>
          <SelectedItemCard
            tone="amber"
            title={formatUnitLabel(selectedUnit)}
            subtitle={selectedHierarchyDef.label}
            onClear={onClearSelection}
            clearLabel="Clear selected unit"
          >
            {isVariableMode ? (
              <div>
                <div className="text-xs text-amber-700 dark:text-amber-300">{activeCategoryName}</div>
                <div className="text-2xl font-bold text-amber-800 dark:text-amber-200">
                  {formatValue(getUnitVariableValue(selectedUnit))}
                </div>
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{activeVariableLabel}</div>
              </div>
            ) : (
              <div>
                <div className="text-2xl font-bold text-amber-800 dark:text-amber-200">
                  {formatMetricValue(selectedUnit[selectedMetric], selectedMetricDef.format)}
                </div>
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{selectedMetricDef.label}</div>
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-amber-800 dark:text-amber-300">
              <div>Area: {formatArea(selectedUnit.areaSqKm || 0)} km²</div>
              <div>Pop: {(selectedUnit.population || 0).toLocaleString()}</div>
              <div>Households: {(selectedUnit.households || 0).toLocaleString()}</div>
              <div>Dwellings: {(selectedUnit.dwellings || 0).toLocaleString()}</div>
              <div>DA count: {selectedUnit.daCount.toLocaleString()}</div>
              <div>DB count: {selectedUnit.dbCount.toLocaleString()}</div>
            </div>
          </SelectedItemCard>
        </SidebarSection>
      )}

      {/* Unit list */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading census data...
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center text-sm text-red-500">
            <p className="font-medium">Error loading census data</p>
            <p>{error}</p>
          </div>
        </div>
      ) : (
        <div>
          <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur">
            <span>
              Top units by {isVariableMode ? activeVariableLabel || 'variable' : selectedMetricDef.label.toLowerCase()}
            </span>
            {filteredUnits.length > MAX_ROWS && <span>Showing {MAX_ROWS}</span>}
          </div>
          <div className="divide-y divide-border">
            {sortedUnits.map((unit) => {
              const isSelected = selectedUnit?.id === unit.id
              const displayValue = isVariableMode
                ? formatValue(getUnitVariableValue(unit))
                : formatMetricValue(unit[selectedMetric], selectedMetricDef.format)

              return (
                <button
                  key={`${unit.level}-${unit.id}`}
                  onClick={() => onUnitClick(unit)}
                  className={cn(
                    'w-full px-4 py-3 text-left transition-colors hover:bg-accent',
                    isSelected && 'bg-amber-50 dark:bg-amber-950/30',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{formatUnitLabel(unit)}</span>
                    <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{displayValue}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Area {formatArea(unit.areaSqKm || 0)} km² | DA {unit.daCount} | DB {unit.dbCount}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </MapSidebarShell>
  )
}
