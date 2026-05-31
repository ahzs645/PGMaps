import { useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { StudyAreaSelector, type StudyAreaSourceOption } from '@/components/StudyAreaSelector'
import { AppSelect } from '@/components/ui/select'
import {
  FilterChipGroup,
  MapSidebarShell,
  SearchInput,
  SelectedItemCard,
  SidebarSection,
  StatGrid,
} from '@/components/ui/map-panels'
import { BOUNDARY_SOURCE_OPTIONS } from '@/lib/studyArea'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
import { ALL_CATEGORIES, ASSESSMENT_HISTORY_START_YEAR, CATEGORY_LABELS, getCategoryColor, COLOR_METRICS, formatCurrency } from '../constants'
import type {
  AssessmentBoundaryLevel,
  AssessmentBoundarySource,
  Property,
  PropertyCategory,
  ColorMetric,
  BoundaryLevel,
  BoundaryAggregate,
} from '../types'

const BOUNDARY_LABELS: Record<AssessmentBoundaryLevel, string> = {
  healthAuthority: 'Health Authority',
  hsda: 'HSDA',
  lha: 'LHA',
  chsa: 'CHSA',
  regionalDistrict: 'Regional District',
  ct: 'Census Tracts',
  da: 'Dissemination Areas',
  db: 'Dissemination Blocks',
  elementarySchoolCatchment: 'Elementary Catchments',
  secondarySchoolCatchment: 'Secondary Catchments',
  majorWatershed: 'Major River Basins',
  watershedGroup: 'Watershed Groups',
  assessmentWatershed: 'Assessment Watersheds',
}

const BOUNDARY_OPTIONS: { value: BoundaryLevel; label: string }[] = [
  { value: 'none', label: 'None' },
  ...Object.entries(BOUNDARY_LABELS).map(([value, label]) => ({
    value: value as AssessmentBoundaryLevel,
    label,
  })),
]

interface BcAssessmentSidebarProps {
  className?: string
  properties: Property[]
  filteredProperties: Property[]
  selectedCategories: PropertyCategory[]
  selectedProperty: Property | null
  selectedBoundary: BoundaryAggregate | null
  boundaryAggregates: Map<string, BoundaryAggregate>
  searchQuery: string
  colorMetric: ColorMetric
  boundarySource: AssessmentBoundarySource
  boundaryLevel: BoundaryLevel
  loading: boolean
  error: string | null
  showTimeline: boolean
  timelineYear: number
  timelineYearOptions: number[]
  onSearchQueryChange: (query: string) => void
  onToggleCategory: (category: PropertyCategory) => void
  onColorMetricChange: (metric: ColorMetric) => void
  onBoundarySourceChange: (source: AssessmentBoundarySource) => void
  onBoundaryLevelChange: (level: BoundaryLevel) => void
  onPropertyClick: (property: Property) => void
  onClearSelection: () => void
  onToggleTimeline: () => void
  onTimelineYearChange: (year: number) => void
}

const ASSESSMENT_BOUNDARY_SOURCES = new Set<AssessmentBoundarySource>(['bcHealth', 'census', 'cityPG', 'watershed'])

function isAssessmentBoundarySource(value: string): value is AssessmentBoundarySource {
  return ASSESSMENT_BOUNDARY_SOURCES.has(value as AssessmentBoundarySource)
}

const REGION_SOURCE_OPTIONS: Array<StudyAreaSourceOption<AssessmentBoundarySource>> = BOUNDARY_SOURCE_OPTIONS.filter(
  (option) => isAssessmentBoundarySource(option.value),
).map((option) => {
  if (option.value === 'census') {
    return {
      value: 'census',
      label: 'Census Boundaries',
      description: 'CT -> DA -> DB',
    }
  }
  return {
    value: option.value as AssessmentBoundarySource,
    label: option.label,
    description: option.description,
  }
})

const REGION_LEVEL_OPTIONS: Record<
  AssessmentBoundarySource,
  Array<{ value: AssessmentBoundaryLevel; label: string }>
> = {
  bcHealth: [
    { value: 'chsa', label: 'CHSA' },
    { value: 'lha', label: 'LHA' },
    { value: 'hsda', label: 'HSDA' },
    { value: 'healthAuthority', label: 'Health Authority' },
  ],
  regionalDistrict: [{ value: 'regionalDistrict', label: 'Regional District' }],
  census: [
    { value: 'ct', label: 'Census Tracts' },
    { value: 'da', label: 'Dissemination Areas' },
    { value: 'db', label: 'Dissemination Blocks' },
  ],
  cityPG: [
    { value: 'elementarySchoolCatchment', label: 'Elementary Catchments' },
    { value: 'secondarySchoolCatchment', label: 'Secondary Catchments' },
  ],
  watershed: [
    { value: 'majorWatershed', label: 'Major River Basins' },
    { value: 'watershedGroup', label: 'Watershed Groups' },
    { value: 'assessmentWatershed', label: 'Assessment Watersheds' },
  ],
}

export function formatNumber(n: number): string {
  return n.toLocaleString()
}

export function HistorySparkline({ values }: { values: number[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-blue-600 dark:text-blue-400">10-Year Assessment History</span>
        {hovered !== null && (
          <span className="text-xs font-semibold text-blue-900 dark:text-blue-200">
            {ASSESSMENT_HISTORY_START_YEAR + hovered}: ${formatNumber(values[hovered])}
          </span>
        )}
      </div>
      <div className="flex items-end gap-0.5" style={{ height: 40 }}>
        {values.map((v, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${ASSESSMENT_HISTORY_START_YEAR + i}: $${formatNumber(v)}`}
            className={cn(
              'flex h-full flex-1 cursor-pointer items-end rounded-t focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
            )}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
            onPointerDown={() => setHovered(i)}
          >
            <span
              className={cn(
                'w-full rounded-t transition-colors',
                hovered === i ? 'bg-blue-600 dark:bg-blue-300' : 'bg-blue-400 dark:bg-blue-500',
              )}
              style={{ height: `${((v - min) / range) * 100}%`, minHeight: 2 }}
            />
          </button>
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-blue-500 dark:text-blue-400">
        <span>{ASSESSMENT_HISTORY_START_YEAR}</span>
        <span>{ASSESSMENT_HISTORY_START_YEAR + values.length - 1}</span>
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
        <span className="text-xs text-orange-600 dark:text-orange-400">Avg 10-Year History</span>
        {hovered !== null && (
          <span className="text-xs font-semibold text-orange-900 dark:text-orange-200">
            {ASSESSMENT_HISTORY_START_YEAR + hovered}: ${formatNumber(values[hovered])}
          </span>
        )}
      </div>
      <div className="flex items-end gap-0.5" style={{ height: 40 }}>
        {values.map((v, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${ASSESSMENT_HISTORY_START_YEAR + i}: $${formatNumber(v)}`}
            className={cn(
              'flex h-full flex-1 cursor-pointer items-end rounded-t focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600',
            )}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
            onPointerDown={() => setHovered(i)}
          >
            <span
              className={cn(
                'w-full rounded-t transition-colors',
                hovered === i ? 'bg-orange-600 dark:bg-orange-300' : 'bg-orange-400 dark:bg-orange-500',
              )}
              style={{ height: `${((v - min) / range) * 100}%`, minHeight: 2 }}
            />
          </button>
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-orange-500 dark:text-orange-400">
        <span>{ASSESSMENT_HISTORY_START_YEAR}</span>
        <span>{ASSESSMENT_HISTORY_START_YEAR + values.length - 1}</span>
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
  boundaryAggregates,
  searchQuery,
  colorMetric,
  boundarySource,
  boundaryLevel,
  loading,
  error,
  showTimeline,
  timelineYear,
  timelineYearOptions,
  onSearchQueryChange,
  onToggleCategory,
  onColorMetricChange,
  onBoundarySourceChange,
  onBoundaryLevelChange,
  onPropertyClick,
  onClearSelection,
  onToggleTimeline,
  onTimelineYearChange,
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

  const blockAverageValue = useMemo(() => {
    if (boundaryAggregates.size === 0) return 0
    const aggregates = Array.from(boundaryAggregates.values())
    return Math.round(aggregates.reduce((sum, boundary) => sum + boundary.avgAssessed, 0) / aggregates.length)
  }, [boundaryAggregates])

  const showingBlockOverview =
    !selectedProperty && !selectedBoundary && boundaryLevel !== 'none' && boundaryAggregates.size > 0

  const avgValue = useMemo(() => {
    if (showingBlockOverview) return blockAverageValue
    if (filteredProperties.length === 0) return 0
    return Math.round(totalValue / filteredProperties.length)
  }, [blockAverageValue, filteredProperties.length, showingBlockOverview, totalValue])

  const [filtersOpen, setFiltersOpen] = useState(false)
  const levelOptions = REGION_LEVEL_OPTIONS[boundarySource]
  const activeRegionLevel: AssessmentBoundaryLevel =
    boundaryLevel === 'none' || !levelOptions.some((option) => option.value === boundaryLevel)
      ? levelOptions[0].value
      : boundaryLevel

  const colorMetricLabel = COLOR_METRICS.find((m) => m.value === colorMetric)?.label ?? ''
  const boundaryLabel = BOUNDARY_OPTIONS.find((b) => b.value === boundaryLevel)?.label ?? ''
  const allCategoriesVisible = ALL_CATEGORIES.filter((c) => (categoryCounts.get(c) || 0) > 0)
  const categorySummary = (() => {
    if (selectedCategories.length === 0) return 'None'
    if (selectedCategories.length === allCategoriesVisible.length) return 'All'
    const labels = selectedCategories.map((c) => CATEGORY_LABELS[c])
    if (labels.length <= 2) return labels.join(', ')
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`
  })()

  return (
    <MapSidebarShell
      className={className}
      title="BC Assessment"
      subtitle="Prince George Property Data"
      dataset={DATASETS.bcAssessment}
      actions={
        <div className="flex items-center gap-2">
          {showTimeline && (
            <AppSelect
              value={String(timelineYear)}
              onValueChange={(value) => onTimelineYearChange(Number(value))}
              options={timelineYearOptions.map((year) => ({ value: String(year), label: String(year) }))}
              className="w-24"
              triggerClassName="h-9 rounded-md text-xs"
            />
          )}
          <button
            type="button"
            onClick={onToggleTimeline}
            className={cn(
              'flex size-9 items-center justify-center rounded-lg transition-colors',
              showTimeline ? 'bg-sky-500 text-white hover:bg-sky-600' : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
            aria-pressed={showTimeline}
            title={showTimeline ? 'Hide timeline' : 'Show timeline'}
          >
            <Clock className="size-5" />
          </button>
        </div>
      }
    >
      <StudyAreaSelector<AssessmentBoundarySource, AssessmentBoundaryLevel>
        source={boundaryLevel === 'none' ? undefined : boundarySource}
        sourceOptions={REGION_SOURCE_OPTIONS}
        level={activeRegionLevel}
        levelOptions={boundaryLevel === 'none' ? [] : levelOptions}
        onSourceChange={onBoundarySourceChange}
        onSelectedSourceClick={() => onBoundaryLevelChange('none')}
        onLevelChange={(level) => onBoundaryLevelChange(level)}
        levelSelectId="bc-assessment-study-area-level"
      />

      {/* Stats & Search */}
      <SidebarSection>
        <StatGrid
          className="mb-3"
          stats={[
            {
              label: showingBlockOverview ? 'Blocks' : 'Properties',
              value: formatNumber(showingBlockOverview ? boundaryAggregates.size : filteredProperties.length),
              valueClassName: 'text-xl',
            },
            {
              label: showingBlockOverview ? 'Avg Block' : 'Avg Value',
              value: formatCurrency(avgValue),
              valueClassName: 'text-xl',
            },
            { label: 'Total Value', value: formatCurrency(totalValue) },
          ]}
        />

        {selectedBoundary && (
          <SelectedItemCard
            className="mb-3"
            tone="orange"
            eyebrow="Active block"
            title={selectedBoundary.boundaryName}
            subtitle={`${formatNumber(selectedBoundary.count)} properties`}
            onClear={onClearSelection}
            rows={[
              { label: 'Avg Assessed', value: `$${formatNumber(selectedBoundary.avgAssessed)}` },
              { label: 'Avg Land', value: `$${formatNumber(selectedBoundary.avgLand)}` },
              { label: 'Avg Building', value: `$${formatNumber(selectedBoundary.avgBuilding)}` },
              ...(selectedBoundary.avgYearBuilt
                ? [{ label: 'Avg Year Built', value: selectedBoundary.avgYearBuilt }]
                : []),
            ]}
          >
            {Object.keys(selectedBoundary.categoryCounts).length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 text-xs text-orange-600 dark:text-orange-400">Property Types</div>
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
          </SelectedItemCard>
        )}

        {selectedProperty && (
          <SelectedItemCard
            className="mb-3"
            tone="blue"
            eyebrow="Active property"
            title={selectedProperty.address}
            subtitle={selectedProperty.description}
            onClear={onClearSelection}
            rows={[
              { label: 'Total Assessed', value: `$${formatNumber(selectedProperty.totalAssessed)}` },
              { label: 'Land', value: `$${formatNumber(selectedProperty.totalLand)}` },
              { label: 'Building', value: `$${formatNumber(selectedProperty.totalBuilding)}` },
              ...(selectedProperty.yearBuilt ? [{ label: 'Year Built', value: selectedProperty.yearBuilt }] : []),
            ]}
          >
            {selectedProperty.histValues && selectedProperty.histValues.length > 1 && (
              <HistorySparkline values={selectedProperty.histValues} />
            )}
          </SelectedItemCard>
        )}

        <SearchInput
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search by address..."
          className="focus:ring-blue-500"
        />
      </SidebarSection>

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
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', filtersOpen && 'rotate-180')}
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
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Color By</h2>
              <div className="flex flex-wrap gap-1.5">
                <FilterChipGroup
                  items={COLOR_METRICS.map(({ value, label }) => ({ value, label }))}
                  selectedValues={[colorMetric]}
                  onToggle={onColorMetricChange}
                  showDot={false}
                  selectedClassName="border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                />
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Property Type</h2>
              <FilterChipGroup
                items={ALL_CATEGORIES.map((category) => ({
                  value: category,
                  label: CATEGORY_LABELS[category],
                  count: formatNumber(categoryCounts.get(category) || 0),
                  color: getCategoryColor(category),
                  disabled: (categoryCounts.get(category) || 0) === 0,
                })).filter((item) => item.count !== '0')}
                selectedValues={selectedCategories}
                onToggle={onToggleCategory}
              />
            </div>

            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Quick Boundaries
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {[{ value: 'none' as const, label: 'None' }, ...levelOptions].map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => onBoundaryLevelChange(value)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      boundaryLevel === value
                        ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400'
                        : 'border-input text-muted-foreground hover:bg-accent',
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
        <div>
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
                    isSelected && 'bg-blue-50 dark:bg-blue-950/30',
                  )}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-medium text-foreground">{prop.address}</span>
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
    </MapSidebarShell>
  )
}
