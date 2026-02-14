import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { CENSUS_HIERARCHIES, CENSUS_METRICS, formatMetricValue } from '../constants'
import type { CensusHierarchyLevel, CensusMetricKey, CensusMetricOption, CensusUnit } from '../types'

interface CensusSidebarProps {
  units: CensusUnit[]
  filteredUnits: CensusUnit[]
  selectedUnit: CensusUnit | null
  selectedMetric: CensusMetricKey
  selectedHierarchy: CensusHierarchyLevel
  availableMetrics: CensusMetricOption[]
  searchQuery: string
  loading: boolean
  error: string | null
  onMetricChange: (metric: CensusMetricKey) => void
  onHierarchyChange: (level: CensusHierarchyLevel) => void
  onSearchQueryChange: (query: string) => void
  onUnitClick: (unit: CensusUnit) => void
  onClearSelection: () => void
}

const MAX_ROWS = 140

function formatUnitLabel(unit: CensusUnit): string {
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

function formatArea(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

export function CensusSidebar({
  units,
  filteredUnits,
  selectedUnit,
  selectedMetric,
  selectedHierarchy,
  availableMetrics,
  searchQuery,
  loading,
  error,
  onMetricChange,
  onHierarchyChange,
  onSearchQueryChange,
  onUnitClick,
  onClearSelection
}: CensusSidebarProps) {
  const selectedMetricDef = useMemo(
    () => availableMetrics.find((metric) => metric.key === selectedMetric)
      || availableMetrics[0]
      || CENSUS_METRICS[0],
    [availableMetrics, selectedMetric]
  )
  const selectedHierarchyDef = useMemo(
    () => CENSUS_HIERARCHIES.find((level) => level.key === selectedHierarchy) || CENSUS_HIERARCHIES[0],
    [selectedHierarchy]
  )

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
      const av = a[selectedMetric]
      const bv = b[selectedMetric]
      if (av == null && bv == null) return a.id.localeCompare(b.id)
      if (av == null) return 1
      if (bv == null) return -1
      return bv - av
    })
    return sorted.slice(0, MAX_ROWS)
  }, [filteredUnits, selectedMetric])

  return (
    <div className="z-10 flex h-full w-[350px] flex-col border-r border-border bg-background/95 shadow-xl backdrop-blur">
      <div className="border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">Census Hierarchy</h1>
        <p className="text-sm text-muted-foreground">CD, CSD, CT, DA, and DB boundary views</p>
      </div>

      <div className="border-b border-border bg-background/95 px-4 py-3">
        <div className="mb-2 text-xs text-muted-foreground">
          {filteredUnits.length} of {units.length} units
        </div>
        <div className="space-y-2">
          <select
            value={selectedHierarchy}
            onChange={(event) => onHierarchyChange(event.target.value as CensusHierarchyLevel)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {CENSUS_HIERARCHIES.map((level) => (
              <option key={level.key} value={level.key}>
                {level.label}
              </option>
            ))}
          </select>

          <select
            value={selectedMetric}
            onChange={(event) => onMetricChange(event.target.value as CensusMetricKey)}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {availableMetrics.map((metric) => (
              <option key={metric.key} value={metric.key}>
                {metric.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border-b border-border bg-background/95 p-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={`Search ${selectedHierarchyDef.label}...`}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
      </div>

      <div className="border-b border-border bg-background/95 px-4 py-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-base font-bold text-foreground">{filteredUnits.length.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground">units</div>
          </div>
          <div>
            <div className="text-base font-bold text-foreground">{totals.population.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground">population</div>
          </div>
          <div>
            <div className="text-base font-bold text-foreground">{formatArea(totals.areaSqKm)}</div>
            <div className="text-[10px] text-muted-foreground">km² area</div>
          </div>
        </div>
      </div>

      {selectedUnit && (
        <div className="border-b border-amber-300/60 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-950/25">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {formatUnitLabel(selectedUnit)}
              </div>
              <div className="text-xs text-amber-700 dark:text-amber-300">
                {selectedHierarchyDef.label} | {selectedMetricDef.label}
              </div>
            </div>
            <button
              onClick={onClearSelection}
              className="text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
              aria-label="Clear selected unit"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="text-2xl font-bold text-amber-800 dark:text-amber-200">
            {formatMetricValue(selectedUnit[selectedMetric], selectedMetricDef.format)}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-amber-800 dark:text-amber-300">
            <div>Area: {formatArea(selectedUnit.areaSqKm || 0)} km²</div>
            <div>Pop: {(selectedUnit.population || 0).toLocaleString()}</div>
            <div>Households: {(selectedUnit.households || 0).toLocaleString()}</div>
            <div>Dwellings: {(selectedUnit.dwellings || 0).toLocaleString()}</div>
            <div>DA count: {selectedUnit.daCount.toLocaleString()}</div>
            <div>DB count: {selectedUnit.dbCount.toLocaleString()}</div>
          </div>
        </div>
      )}

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
        <div className="flex-1 overflow-y-auto">
          <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur">
            <span>Top units by {selectedMetricDef.label.toLowerCase()}</span>
            {filteredUnits.length > MAX_ROWS && <span>Showing {MAX_ROWS}</span>}
          </div>
          <div className="divide-y divide-border">
            {sortedUnits.map((unit) => {
              const isSelected = selectedUnit?.id === unit.id
              return (
                <button
                  key={`${unit.level}-${unit.id}`}
                  onClick={() => onUnitClick(unit)}
                  className={cn(
                    'w-full px-4 py-3 text-left transition-colors hover:bg-accent',
                    isSelected && 'bg-amber-50 dark:bg-amber-950/30'
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{formatUnitLabel(unit)}</span>
                    <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                      {formatMetricValue(unit[selectedMetric], selectedMetricDef.format)}
                    </span>
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
    </div>
  )
}
