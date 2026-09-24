import { useMemo, useState } from 'react'
import { formatCompactCurrency, formatCurrency } from '@/lib/format'
import { Clock } from 'lucide-react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { AppSelect } from '@/components/ui/select'
import {
  CollapsibleSection,
  FilterChipGroup,
  MapSidebarShell,
  SearchInput,
  SelectedItemCard,
  SidebarSection,
  StatGrid,
} from '@/components/ui/map-panels'
import { ListHeader, ListState, ResultRow } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import {
  BOUNDARY_SOURCE_OPTIONS,
  createStudyAreaLevelOptions,
  type StudyAreaLevelOption,
  type StudyAreaSourceOption,
} from '@/lib/studyArea'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'
import { DATASETS } from '@/lib/dataCatalog'
import {
  ALL_CATEGORIES,
  ASSESSMENT_HISTORY_START_YEAR,
  CATEGORY_LABELS,
  getCategoryColor,
  COLOR_METRICS,
} from '../constants'
import type {
  AssessmentBoundaryLevel,
  AssessmentBoundarySource,
  Property,
  PropertyCategory,
  ColorMetric,
  BoundaryLevel,
  BoundaryAggregate,
} from '../types'

const BOUNDARY_OPTIONS: { value: BoundaryLevel; label: string }[] = [
  { value: 'none', label: 'None' },
  ...createStudyAreaLevelOptions<AssessmentBoundaryLevel>([
    'healthAuthority',
    'hsda',
    'lha',
    'chsa',
    'regionalDistrict',
    'ct',
    'da',
    'db',
    'elementarySchoolCatchment',
    'secondarySchoolCatchment',
    'majorWatershed',
    'watershedGroup',
    'assessmentWatershed',
  ]),
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

const ASSESSMENT_BOUNDARY_SOURCES = new Set<AssessmentBoundarySource>([
  'bcHealth',
  'regionalDistrict',
  'census',
  'cityPG',
  'watershed',
])

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
    group: option.group,
  }
})

const REGION_LEVEL_OPTIONS: Record<AssessmentBoundarySource, Array<StudyAreaLevelOption<AssessmentBoundaryLevel>>> = {
  bcHealth: createStudyAreaLevelOptions(['chsa', 'lha', 'hsda', 'healthAuthority'] as const),
  regionalDistrict: createStudyAreaLevelOptions(['regionalDistrict'] as const),
  census: createStudyAreaLevelOptions(['ct', 'da', 'db'] as const),
  cityPG: createStudyAreaLevelOptions(['elementarySchoolCatchment', 'secondarySchoolCatchment'] as const),
  watershed: createStudyAreaLevelOptions(['majorWatershed', 'watershedGroup', 'assessmentWatershed'] as const),
}

const SPARKLINE_TONES = {
  // Property history: blue, matching the selected-property card.
  blue: {
    label: 'text-blue-600 dark:text-blue-400',
    value: 'text-blue-900 dark:text-blue-200',
    focus: 'focus-visible:outline-blue-600',
    bar: 'bg-blue-400 dark:bg-blue-500',
    barActive: 'bg-blue-600 dark:bg-blue-300',
    axis: 'text-blue-500 dark:text-blue-400',
  },
  // Boundary averages: orange, matching the selected-block card.
  orange: {
    label: 'text-orange-600 dark:text-orange-400',
    value: 'text-orange-900 dark:text-orange-200',
    focus: 'focus-visible:outline-orange-600',
    bar: 'bg-orange-400 dark:bg-orange-500',
    barActive: 'bg-orange-600 dark:bg-orange-300',
    axis: 'text-orange-500 dark:text-orange-400',
  },
} as const

export function HistorySparkline({
  values,
  tone = 'blue',
  label = '10-Year Assessment History',
}: {
  values: number[]
  tone?: keyof typeof SPARKLINE_TONES
  label?: string
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const colors = SPARKLINE_TONES[tone]

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className={cn('text-xs', colors.label)}>{label}</span>
        {hovered !== null && (
          <span className={cn('text-xs font-semibold', colors.value)}>
            {ASSESSMENT_HISTORY_START_YEAR + hovered}: {formatCurrency(values[hovered])}
          </span>
        )}
      </div>
      <div className="flex items-end gap-0.5" style={{ height: 40 }}>
        {values.map((v, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${ASSESSMENT_HISTORY_START_YEAR + i}: ${formatCurrency(v)}`}
            className={cn(
              'flex h-full flex-1 cursor-pointer items-end rounded-t focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
              colors.focus,
            )}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
            onPointerDown={() => setHovered(i)}
          >
            <span
              className={cn('w-full rounded-t transition-colors', hovered === i ? colors.barActive : colors.bar)}
              style={{ height: `${((v - min) / range) * 100}%`, minHeight: 2 }}
            />
          </button>
        ))}
      </div>
      <div className={cn('mt-0.5 flex justify-between text-xs', colors.axis)}>
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
              showTimeline
                ? 'bg-sky-500 text-white hover:bg-sky-600'
                : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
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
              value: formatCompactCurrency(avgValue),
              valueClassName: 'text-xl',
            },
            { label: 'Total Value', value: formatCompactCurrency(totalValue) },
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
              { label: 'Avg Assessed', value: formatCurrency(selectedBoundary.avgAssessed) },
              { label: 'Avg Land', value: formatCurrency(selectedBoundary.avgLand) },
              { label: 'Avg Building', value: formatCurrency(selectedBoundary.avgBuilding) },
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
                        className="flex items-center gap-1 rounded-full border border-orange-300/60 px-2 py-0.5 text-xs text-orange-800 dark:border-orange-700/60 dark:text-orange-300"
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
              <HistorySparkline values={selectedBoundary.avgHistory} tone="orange" label="Avg 10-Year History" />
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
              { label: 'Total Assessed', value: formatCurrency(selectedProperty.totalAssessed) },
              { label: 'Land', value: formatCurrency(selectedProperty.totalLand) },
              { label: 'Building', value: formatCurrency(selectedProperty.totalBuilding) },
              ...(selectedProperty.yearBuilt ? [{ label: 'Year Built', value: selectedProperty.yearBuilt }] : []),
            ]}
          >
            {selectedProperty.histValues && selectedProperty.histValues.length > 1 && (
              <HistorySparkline values={selectedProperty.histValues} />
            )}
          </SelectedItemCard>
        )}

        <SearchInput
          icon
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onClear={() => onSearchQueryChange('')}
          placeholder="Search by address..."
          aria-label="Search by address"
          className="focus:ring-blue-500"
        />
      </SidebarSection>

      {/* Filters (collapsible) */}
      <CollapsibleSection
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        label={<span className="text-sm">Filters</span>}
        summary={
          filtersOpen ? undefined : `${categorySummary} · Color: ${colorMetricLabel} · Boundaries: ${boundaryLabel}`
        }
        className="px-1"
        contentClassName="space-y-4 px-3 pb-4"
      >
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
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Quick Boundaries</h2>
          <FilterChipGroup<BoundaryLevel>
            items={[{ value: 'none' as const, label: 'None' }, ...levelOptions]}
            selectedValues={[boundaryLevel]}
            onToggle={onBoundaryLevelChange}
            showDot={false}
            selectedClassName="border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400"
          />
        </div>
      </CollapsibleSection>

      {/* List + selection details (all scrollable) */}
      <ListState
        loading={loading}
        loadingLabel="Loading assessment data..."
        error={error}
        errorTitle="Error loading data"
        empty={filteredProperties.length === 0}
        emptyLabel="No properties match these filters."
      >
        {filteredProperties.length > 0 && (
          <>
            <ListHeader count={filteredProperties.length} noun={['property', 'properties']} />
            <VirtualResultList
              items={filteredProperties}
              getKey={(property) => property.id}
              estimateSize={64}
              label="Properties"
            >
              {(prop) => (
                <ResultRow
                  title={prop.address}
                  subtitle={`${formatCompactCurrency(prop.totalAssessed)} · ${prop.description}`}
                  dotColor={getCategoryColor(prop.category)}
                  selected={selectedProperty?.id === prop.id}
                  onClick={() => onPropertyClick(prop)}
                />
              )}
            </VirtualResultList>
          </>
        )}
      </ListState>
    </MapSidebarShell>
  )
}
