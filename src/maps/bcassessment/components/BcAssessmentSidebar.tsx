import { useMemo, useState } from 'react'
import { DatasetInfo } from '@/components/DatasetInfo'
import { StudyAreaSelector, type StudyAreaSourceOption } from '@/components/StudyAreaSelector'
import { BOUNDARY_SOURCE_OPTIONS } from '@/lib/studyArea'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
import {
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  getCategoryColor,
  COLOR_METRICS,
  formatCurrency,
} from '../constants'
import type { Property, PropertyCategory, ColorMetric, BoundaryLevel, BoundaryAggregate } from '../types'

const BOUNDARY_OPTIONS: { value: BoundaryLevel; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'ct', label: 'Census Tracts' },
  { value: 'da', label: 'Dissemination Areas' },
  { value: 'db', label: 'Dissemination Blocks' },
]

interface BcAssessmentSidebarProps {
  className?: string
  properties: Property[]
  filteredProperties: Property[]
  selectedCategories: PropertyCategory[]
  selectedProperty: Property | null
  selectedBoundary: BoundaryAggregate | null
  searchQuery: string
  colorMetric: ColorMetric
  boundaryLevel: BoundaryLevel
  loading: boolean
  error: string | null
  onSearchQueryChange: (query: string) => void
  onToggleCategory: (category: PropertyCategory) => void
  onColorMetricChange: (metric: ColorMetric) => void
  onBoundaryLevelChange: (level: BoundaryLevel) => void
  onPropertyClick: (property: Property) => void
  onClearSelection: () => void
}

const REGION_SOURCE_OPTIONS: Array<StudyAreaSourceOption<string>> = BOUNDARY_SOURCE_OPTIONS.map((option) => {
  if (option.value === 'census') {
    return {
      value: option.value,
      label: 'Census Boundaries',
      description: 'CT -> DA -> DB',
    }
  }
  return {
    value: option.value,
    label: option.label,
    description: option.description,
    disabled: true,
    disabledReason: 'BC Assessment parcels are aggregated to census boundaries only.',
  }
})

const REGION_LEVEL_OPTIONS: Array<{ value: Exclude<BoundaryLevel, 'none'>; label: string }> = [
  { value: 'ct', label: 'Census Tracts' },
  { value: 'da', label: 'Dissemination Areas' },
  { value: 'db', label: 'Dissemination Blocks' },
]

function formatNumber(n: number): string {
  return n.toLocaleString()
}

const START_YEAR = 2017

function HistorySparkline({ values }: { values: number[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-blue-600 dark:text-blue-400">
          10-Year Assessment History
        </span>
        {hovered !== null && (
          <span className="text-xs font-semibold text-blue-900 dark:text-blue-200">
            {START_YEAR + hovered}: ${formatNumber(values[hovered])}
          </span>
        )}
      </div>
      <div className="flex items-end gap-0.5" style={{ height: 40 }}>
        {values.map((v, i) => (
          <div
            key={i}
            className={cn(
              'flex-1 cursor-pointer rounded-t transition-colors',
              hovered === i
                ? 'bg-blue-600 dark:bg-blue-300'
                : 'bg-blue-400 dark:bg-blue-500'
            )}
            style={{ height: `${((v - min) / range) * 100}%`, minHeight: 2 }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-blue-500 dark:text-blue-400">
        <span>{START_YEAR}</span>
        <span>{START_YEAR + values.length - 1}</span>
      </div>
    </div>
  )
}

function BoundaryHistorySparkline({ values }: { values: number[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-orange-600 dark:text-orange-400">
          Avg 10-Year History
        </span>
        {hovered !== null && (
          <span className="text-xs font-semibold text-orange-900 dark:text-orange-200">
            {START_YEAR + hovered}: ${formatNumber(values[hovered])}
          </span>
        )}
      </div>
      <div className="flex items-end gap-0.5" style={{ height: 40 }}>
        {values.map((v, i) => (
          <div
            key={i}
            className={cn(
              'flex-1 cursor-pointer rounded-t transition-colors',
              hovered === i
                ? 'bg-orange-600 dark:bg-orange-300'
                : 'bg-orange-400 dark:bg-orange-500'
            )}
            style={{ height: `${((v - min) / range) * 100}%`, minHeight: 2 }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-orange-500 dark:text-orange-400">
        <span>{START_YEAR}</span>
        <span>{START_YEAR + values.length - 1}</span>
      </div>
    </div>
  )
}

export function BcAssessmentSidebar({
  className,
  properties,
  filteredProperties,
  selectedCategories,
  selectedProperty,
  selectedBoundary,
  searchQuery,
  colorMetric,
  boundaryLevel,
  loading,
  error,
  onSearchQueryChange,
  onToggleCategory,
  onColorMetricChange,
  onBoundaryLevelChange,
  onPropertyClick,
  onClearSelection,
}: BcAssessmentSidebarProps) {
  const categoryCounts = useMemo(() => {
    const counts = new globalThis.Map<PropertyCategory, number>()
    properties.forEach((p) => {
      counts.set(p.category, (counts.get(p.category) || 0) + 1)
    })
    return counts
  }, [properties])

  const totalValue = useMemo(() => {
    return filteredProperties.reduce((sum, p) => sum + p.totalAssessed, 0)
  }, [filteredProperties])

  const avgValue = useMemo(() => {
    if (filteredProperties.length === 0) return 0
    return Math.round(totalValue / filteredProperties.length)
  }, [totalValue, filteredProperties.length])

  const [filtersOpen, setFiltersOpen] = useState(false)
  const activeRegionLevel: Exclude<BoundaryLevel, 'none'> = boundaryLevel === 'none' ? 'ct' : boundaryLevel

  const colorMetricLabel =
    COLOR_METRICS.find((m) => m.value === colorMetric)?.label ?? ''
  const boundaryLabel =
    BOUNDARY_OPTIONS.find((b) => b.value === boundaryLevel)?.label ?? ''
  const allCategoriesVisible = ALL_CATEGORIES.filter(
    (c) => (categoryCounts.get(c) || 0) > 0
  )
  const categorySummary = (() => {
    if (selectedCategories.length === 0) return 'None'
    if (selectedCategories.length === allCategoriesVisible.length) return 'All'
    const labels = selectedCategories.map((c) => CATEGORY_LABELS[c])
    if (labels.length <= 2) return labels.join(', ')
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`
  })()

  return (
    <div className={cn('z-10 flex h-full w-full flex-col border-r border-border bg-background/95 shadow-xl backdrop-blur', className)}>
      {/* Header */}
      <div className="border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">BC Assessment</h1>
        <p className="text-sm text-muted-foreground">Prince George Property Data</p>
      </div>

      <DatasetInfo dataset={DATASETS.bcAssessment} />

      <StudyAreaSelector<string, Exclude<BoundaryLevel, 'none'>>
        source="census"
        sourceOptions={REGION_SOURCE_OPTIONS}
        level={activeRegionLevel}
        levelOptions={REGION_LEVEL_OPTIONS}
        onSourceChange={() => undefined}
        onLevelChange={(level) => onBoundaryLevelChange(level)}
        showPoints={boundaryLevel !== 'none'}
        onTogglePoints={() => onBoundaryLevelChange(boundaryLevel === 'none' ? activeRegionLevel : 'none')}
        toggleOnLabel="Hide boundaries"
        toggleOffLabel="Show boundaries"
        levelSelectId="bc-assessment-study-area-level"
      />

      {/* Stats & Search */}
      <div className="border-b border-border bg-background/95 p-4">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Properties</div>
            <div className="text-xl font-bold text-foreground">
              {formatNumber(filteredProperties.length)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Avg Value</div>
            <div className="text-xl font-bold text-foreground">
              {formatCurrency(avgValue)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Total Value</div>
            <div className="text-sm font-medium text-foreground">
              {formatCurrency(totalValue)}
            </div>
          </div>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search by address..."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Filters (collapsible) */}
      <div className="border-b border-border bg-background/95">
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/50"
          aria-expanded={filtersOpen}
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">Filters</div>
            {!filtersOpen && (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {categorySummary} · Color: {colorMetricLabel} · Boundaries: {boundaryLabel}
              </div>
            )}
          </div>
          <svg
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              filtersOpen && 'rotate-180'
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {filtersOpen && (
          <div className="space-y-4 px-4 pb-4">
            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Color By
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {COLOR_METRICS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => onColorMetricChange(value)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      colorMetric === value
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                        : 'border-input text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Property Type
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {ALL_CATEGORIES.map((category) => {
                  const count = categoryCounts.get(category) || 0
                  if (count === 0) return null
                  const selected = selectedCategories.includes(category)
                  const color = getCategoryColor(category)
                  return (
                    <button
                      key={category}
                      onClick={() => onToggleCategory(category)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                        selected ? 'bg-background' : 'border-input text-muted-foreground hover:bg-accent'
                      )}
                      style={selected ? { borderColor: color, color } : undefined}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                      {CATEGORY_LABELS[category]}
                      <span className="opacity-70">{formatNumber(count)}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Census Boundaries
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {BOUNDARY_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => onBoundaryLevelChange(value)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      boundaryLevel === value
                        ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400'
                        : 'border-input text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* List + selection details (all scrollable) */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading assessment data...
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center text-sm text-red-500">
            <p className="font-medium">Error loading data</p>
            <p>{error}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Selected Boundary Detail */}
          {selectedBoundary && (
            <div className="border-b border-orange-300/60 bg-orange-50 p-4 dark:border-orange-800/60 dark:bg-orange-950/30">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-orange-900 dark:text-orange-200">
                    {selectedBoundary.boundaryName}
                  </div>
                  <div className="text-xs text-orange-700 dark:text-orange-300">
                    {formatNumber(selectedBoundary.count)} properties
                  </div>
                </div>
                <button
                  onClick={onClearSelection}
                  className="shrink-0 text-orange-700 hover:text-orange-900 dark:text-orange-300 dark:hover:text-orange-100"
                  aria-label="Clear selection"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div>
                  <span className="text-orange-600 dark:text-orange-400">Avg Assessed</span>
                  <div className="font-semibold text-orange-900 dark:text-orange-200">
                    ${formatNumber(selectedBoundary.avgAssessed)}
                  </div>
                </div>
                <div>
                  <span className="text-orange-600 dark:text-orange-400">Avg Land</span>
                  <div className="font-semibold text-orange-900 dark:text-orange-200">
                    ${formatNumber(selectedBoundary.avgLand)}
                  </div>
                </div>
                <div>
                  <span className="text-orange-600 dark:text-orange-400">Avg Building</span>
                  <div className="font-semibold text-orange-900 dark:text-orange-200">
                    ${formatNumber(selectedBoundary.avgBuilding)}
                  </div>
                </div>
                {selectedBoundary.avgYearBuilt && (
                  <div>
                    <span className="text-orange-600 dark:text-orange-400">Avg Year Built</span>
                    <div className="font-semibold text-orange-900 dark:text-orange-200">
                      {selectedBoundary.avgYearBuilt}
                    </div>
                  </div>
                )}
              </div>

              {Object.keys(selectedBoundary.categoryCounts).length > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 text-xs text-orange-600 dark:text-orange-400">
                    Property Types
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_CATEGORIES.map((cat) => {
                      const count = selectedBoundary.categoryCounts[cat]
                      if (!count) return null
                      const pct = Math.round((count / selectedBoundary.count) * 100)
                      return (
                        <span
                          key={cat}
                          className="flex items-center gap-1 rounded-full border border-orange-300/60 px-2 py-0.5 text-[10px] text-orange-800 dark:border-orange-700/60 dark:text-orange-300"
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: getCategoryColor(cat) }} />
                          {CATEGORY_LABELS[cat]} {pct}%
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {selectedBoundary.avgHistory && selectedBoundary.avgHistory.length > 1 && (
                <BoundaryHistorySparkline values={selectedBoundary.avgHistory} />
              )}
            </div>
          )}

          {/* Selected Property Detail */}
          {selectedProperty && (
            <div className="border-b border-blue-300/60 bg-blue-50 p-4 dark:border-blue-800/60 dark:bg-blue-950/30">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                    {selectedProperty.address}
                  </div>
                  <div className="text-xs text-blue-700 dark:text-blue-300">
                    {selectedProperty.description}
                  </div>
                </div>
                <button
                  onClick={onClearSelection}
                  className="shrink-0 text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
                  aria-label="Clear selection"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div>
                  <span className="text-blue-600 dark:text-blue-400">Total Assessed</span>
                  <div className="font-semibold text-blue-900 dark:text-blue-200">
                    ${formatNumber(selectedProperty.totalAssessed)}
                  </div>
                </div>
                <div>
                  <span className="text-blue-600 dark:text-blue-400">Land</span>
                  <div className="font-semibold text-blue-900 dark:text-blue-200">
                    ${formatNumber(selectedProperty.totalLand)}
                  </div>
                </div>
                <div>
                  <span className="text-blue-600 dark:text-blue-400">Building</span>
                  <div className="font-semibold text-blue-900 dark:text-blue-200">
                    ${formatNumber(selectedProperty.totalBuilding)}
                  </div>
                </div>
                {selectedProperty.yearBuilt && (
                  <div>
                    <span className="text-blue-600 dark:text-blue-400">Year Built</span>
                    <div className="font-semibold text-blue-900 dark:text-blue-200">
                      {selectedProperty.yearBuilt}
                    </div>
                  </div>
                )}
                {selectedProperty.bedrooms != null && (
                  <div>
                    <span className="text-blue-600 dark:text-blue-400">Bedrooms</span>
                    <div className="font-semibold text-blue-900 dark:text-blue-200">
                      {selectedProperty.bedrooms}
                    </div>
                  </div>
                )}
                {selectedProperty.bathrooms != null && (
                  <div>
                    <span className="text-blue-600 dark:text-blue-400">Bathrooms</span>
                    <div className="font-semibold text-blue-900 dark:text-blue-200">
                      {selectedProperty.bathrooms}
                    </div>
                  </div>
                )}
                {selectedProperty.landSize && (
                  <div>
                    <span className="text-blue-600 dark:text-blue-400">Land Size</span>
                    <div className="font-semibold text-blue-900 dark:text-blue-200">
                      {selectedProperty.landSize}
                    </div>
                  </div>
                )}
                {selectedProperty.totalFinishedArea && (
                  <div>
                    <span className="text-blue-600 dark:text-blue-400">Finished Area</span>
                    <div className="font-semibold text-blue-900 dark:text-blue-200">
                      {formatNumber(selectedProperty.totalFinishedArea)} sqft
                    </div>
                  </div>
                )}
                {selectedProperty.salePrice && (
                  <div>
                    <span className="text-blue-600 dark:text-blue-400">Last Sale</span>
                    <div className="font-semibold text-blue-900 dark:text-blue-200">
                      ${formatNumber(selectedProperty.salePrice)}
                    </div>
                  </div>
                )}
                {selectedProperty.pid && (
                  <div>
                    <span className="text-blue-600 dark:text-blue-400">PID</span>
                    <div className="font-semibold text-blue-900 dark:text-blue-200">
                      {selectedProperty.pid}
                    </div>
                  </div>
                )}
              </div>

              {selectedProperty.histValues && selectedProperty.histValues.length > 1 && (
                <HistorySparkline values={selectedProperty.histValues} />
              )}
            </div>
          )}

          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur">
            <span>Properties ({formatNumber(filteredProperties.length)})</span>
          </div>
          <div className="divide-y divide-border">
            {filteredProperties.slice(0, 200).map((prop) => {
              const isSelected = selectedProperty?.id === prop.id
              return (
                <button
                  key={prop.id}
                  onClick={() => onPropertyClick(prop)}
                  className={cn(
                    'w-full px-4 py-3 text-left transition-colors hover:bg-accent',
                    isSelected && 'bg-blue-50 dark:bg-blue-950/30'
                  )}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-medium text-foreground">
                      {prop.address}
                    </span>
                    <span
                      className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: getCategoryColor(prop.category) }}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatCurrency(prop.totalAssessed)}</span>
                    <span>·</span>
                    <span className="line-clamp-1">{prop.description}</span>
                  </div>
                </button>
              )
            })}
            {filteredProperties.length > 200 && (
              <div className="px-4 py-3 text-center text-xs text-muted-foreground">
                Showing 200 of {formatNumber(filteredProperties.length)} — use search to narrow
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
