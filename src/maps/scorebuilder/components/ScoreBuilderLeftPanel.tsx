import { useMemo, useState } from 'react'
import { Layers, Plus, Trash2 } from 'lucide-react'
import { DatasetInfo } from '@/components/DatasetInfo'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import { BOUNDARY_SOURCE_OPTIONS } from '../constants'
import type { ScoreDataSource } from '../types'
import { SCORE_DATA_SOURCES } from '../types'
import { SCORE_BUILDER_DATASETS, type DatasetProfile } from '../lib/datasetCatalog'
import type { MetricRecipe, MetricRecipeFilter, MetricRecipeOperation, MetricRecipeSource } from '../lib/metricRecipes'
import { CENSUS_COMPOSER_PRESETS, censusPresetToMetricRecipe } from '../lib/censusComposer'

interface ScoreBuilderLeftPanelProps {
  className?: string
  boundarySource: BoundarySource
  onBoundarySourceChange: (source: BoundarySource) => void
  selectedRegionLevel: RegionLevel
  onRegionLevelChange: (level: RegionLevel) => void
  boundaryLevelOptions: Array<{ value: RegionLevel; label: string }>
  enabledDataSources: ScoreDataSource[]
  onToggleDataSource: (source: ScoreDataSource) => void
  networkCounts: Array<[string, number]>
  selectedNetworks: string[]
  onToggleNetwork: (network: string) => void
  onSelectAllNetworks: () => void
  onClearNetworks: () => void
  showPoints: boolean
  onTogglePoints: () => void
  regionCount: number
  canUseWalkabilitySourceSurface: boolean
  mapSurface: 'source' | 'boundary'
  onMapSurfaceChange: (surface: 'source' | 'boundary') => void
  customMetricRecipes: MetricRecipe[]
  datasetProfiles: Partial<Record<MetricRecipeSource, DatasetProfile>>
  onCreateCustomMetric: (recipe: MetricRecipe) => void
  onRemoveCustomMetric: (id: string) => void
}

export function ScoreBuilderLeftPanel({
  className,
  boundarySource,
  onBoundarySourceChange,
  selectedRegionLevel,
  onRegionLevelChange,
  boundaryLevelOptions,
  enabledDataSources,
  onToggleDataSource,
  networkCounts,
  selectedNetworks,
  onToggleNetwork,
  onSelectAllNetworks,
  onClearNetworks,
  showPoints,
  onTogglePoints,
  regionCount,
  canUseWalkabilitySourceSurface,
  mapSurface,
  onMapSurfaceChange,
  customMetricRecipes,
  datasetProfiles,
  onCreateCustomMetric,
  onRemoveCustomMetric,
}: ScoreBuilderLeftPanelProps) {
  const enabledSet = useMemo(() => new Set(enabledDataSources), [enabledDataSources])
  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])
  const displayedBoundarySource = canUseWalkabilitySourceSurface && mapSurface === 'source' ? undefined : boundarySource

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur',
        className,
      )}
      data-score-builder-left-panel="true"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Index Inputs</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">{regionCount} regions</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" data-score-builder-scroll="true">
        <DatasetInfo dataset={DATASETS.scoreBuilder} />

        <StudyAreaSelector<BoundarySource, RegionLevel>
          source={displayedBoundarySource}
          sourceOptions={BOUNDARY_SOURCE_OPTIONS}
          level={selectedRegionLevel}
          levelOptions={boundaryLevelOptions}
          onSourceChange={(source) => {
            onBoundarySourceChange(source)
            if (canUseWalkabilitySourceSurface) onMapSurfaceChange('boundary')
          }}
          onSelectedSourceClick={
            canUseWalkabilitySourceSurface ? () => onMapSurfaceChange('source') : undefined
          }
          onLevelChange={onRegionLevelChange}
          showPoints={showPoints}
          onTogglePoints={onTogglePoints}
          levelSelectId="score-builder-level"
          dataPrefix="score-builder"
        />

        {/* Data sources */}
        <section
          className="p-4"
          data-score-builder-section="filters"
        >
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Data sources
          </h3>

          <div className="space-y-2">
            {SCORE_DATA_SOURCES.map((ds) => {
              const active = enabledSet.has(ds.id)
              return (
                <div key={ds.id}>
                  <button
                    type="button"
                    aria-label={`${ds.label} ${ds.id === 'bcAssessment' ? 'Property' : ''} ${active ? 'ON' : 'OFF'}`}
                    onClick={() => onToggleDataSource(ds.id)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-colors',
                      active
                        ? 'border-cyan-500/60 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100'
                        : 'border-input bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{ds.label}</div>
                      <div className="line-clamp-1 text-[10px] text-muted-foreground">
                        {ds.description}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'ml-2 shrink-0 text-xs font-semibold',
                        active ? 'text-cyan-600' : 'text-muted-foreground',
                      )}
                    >
                      {active ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  {ds.id === 'airQuality' && active && (
                    <div className="ml-2 mt-1 space-y-1 border-l-2 border-cyan-200 pl-2 dark:border-cyan-900">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">
                          {selectedNetworks.length} networks
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={onSelectAllNetworks}
                            className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
                          >
                            All
                          </button>
                          <button
                            onClick={onClearNetworks}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            None
                          </button>
                        </div>
                      </div>
                      <div className="max-h-32 space-y-0.5 overflow-y-auto">
                        {networkCounts.map(([network, count]) => (
                          <button
                            key={network}
                            data-score-builder-network={network}
                            onClick={() => onToggleNetwork(network)}
                            className={cn(
                              'flex w-full items-center justify-between rounded px-2 py-1 text-[11px] transition-colors',
                              selectedNetworkSet.has(network)
                                ? 'bg-cyan-50 text-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-100'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <span className="truncate">{network}</span>
                            <span>{count.toLocaleString()}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <CustomMetricBuilder
          recipes={customMetricRecipes}
          datasetProfiles={datasetProfiles}
          onCreate={onCreateCustomMetric}
          onRemove={onRemoveCustomMetric}
        />
      </div>
    </div>
  )
}

function slugifyMetricId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
}

function parseFilterValue(value: string, operator: string) {
  if (operator === 'exists') return undefined
  if (operator === 'in' || operator === 'notIn') {
    return value
      .split(',')
      .map((entry) => parseFilterScalar(entry.trim()))
      .filter((entry) => entry !== '')
  }
  return parseFilterScalar(value.trim())
}

function parseFilterScalar(value: string): string | number | boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  const numeric = Number(value)
  return value !== '' && Number.isFinite(numeric) ? numeric : value
}

export function CustomMetricBuilder({
  recipes,
  datasetProfiles,
  onCreate,
  onRemove,
}: {
  recipes: MetricRecipe[]
  datasetProfiles: Partial<Record<MetricRecipeSource, DatasetProfile>>
  onCreate: (recipe: MetricRecipe) => void
  onRemove: (id: string) => void
}) {
  const [label, setLabel] = useState('School access 800m')
  const [source, setSource] = useState<MetricRecipeSource>('healthyplanPg.educationFacilities')
  const [operation, setOperation] = useState<MetricRecipeOperation>('countWithinCentroidRadius')
  const [radiusMeters, setRadiusMeters] = useState(800)
  const [filterField, setFilterField] = useState('category')
  const [filterOperator, setFilterOperator] = useState<'equals' | 'in' | 'exists'>('equals')
  const [filterValue, setFilterValue] = useState('school_k12')
  const [extraFilters, setExtraFilters] = useState<Array<{ field: string; operator: 'equals' | 'in' | 'exists'; value: string }>>([])
  const [expression, setExpression] = useState('shadeGap * cimdComposite')
  const [censusPresetId, setCensusPresetId] = useState(CENSUS_COMPOSER_PRESETS[0]?.id ?? '')
  const [direction, setDirection] = useState<'higherIsBetter' | 'higherIsWorse'>('higherIsBetter')
  const [format, setFormat] = useState<'count' | 'density' | 'ratio' | 'percent' | 'index'>('count')
  const dataset = SCORE_BUILDER_DATASETS.find((entry) => entry.id === source)
  const profile = datasetProfiles[source]
  const metricId = slugifyMetricId(label || 'custom_metric')
  const selectedIsFormula = source === 'custom' || operation === 'derivedExpression'
  const selectedIsCensus = source === 'census'
  const selectedCensusPreset = CENSUS_COMPOSER_PRESETS.find((preset) => preset.id === censusPresetId) ?? CENSUS_COMPOSER_PRESETS[0]

  return (
    <section className="border-t border-border p-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Custom metric recipe
      </h3>
      <div className="space-y-2 rounded-md border border-border bg-card p-3">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
          placeholder="Metric label"
        />
        <select
          value={source}
          onChange={(event) => {
            const next = event.target.value as MetricRecipeSource
            setSource(next)
            if (next === 'custom') setOperation('derivedExpression')
            if (next === 'census') {
              setOperation('censusVariable')
              setFormat('percent')
              setDirection(selectedCensusPreset?.direction ?? 'higherIsWorse')
              setLabel(selectedCensusPreset?.label ?? 'Census demographic metric')
            }
          }}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
        >
          {SCORE_BUILDER_DATASETS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <div className="text-[10px] text-muted-foreground">{dataset?.description}</div>

        {profile && source !== 'custom' && (
          <div className="rounded border border-border bg-muted/30 p-2 text-[10px] text-muted-foreground">
            <div>
              {profile.rowCount.toLocaleString()} rows · {profile.pointCount.toLocaleString()} points ·{' '}
              {profile.coordinateValidity.validPoints.toLocaleString()} valid coordinates
            </div>
            <div className="mt-1 line-clamp-2">
              Fields: {profile.fields.slice(0, 8).map((field) => field.field).join(', ') || 'none detected'}
            </div>
          </div>
        )}

        {selectedIsCensus ? (
          <>
            <select
              value={censusPresetId}
              onChange={(event) => {
                const preset = CENSUS_COMPOSER_PRESETS.find((entry) => entry.id === event.target.value)
                setCensusPresetId(event.target.value)
                if (preset) {
                  setLabel(preset.label)
                  setDirection(preset.direction)
                  setFormat(preset.format)
                }
              }}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
            >
              {CENSUS_COMPOSER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <div className="rounded border border-border bg-muted/30 p-2 text-[10px] text-muted-foreground">
              {selectedCensusPreset?.description}
            </div>
          </>
        ) : !selectedIsFormula ? (
          <>
            <select
              value={operation}
              onChange={(event) => setOperation(event.target.value as MetricRecipeOperation)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
            >
              <option value="pointCountInPolygon">Count inside boundary</option>
              <option value="pointDensityInPolygon">Density inside boundary</option>
              <option value="countWithinCentroidRadius">Count within centroid radius</option>
              <option value="accessWithinCentroidRadius">Access within centroid radius</option>
              <option value="averagePropertyInPolygon">Average property inside boundary</option>
            </select>
            {(operation === 'countWithinCentroidRadius' || operation === 'accessWithinCentroidRadius') && (
              <input
                type="number"
                min={50}
                step={50}
                value={radiusMeters}
                onChange={(event) => setRadiusMeters(Number(event.target.value))}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                placeholder="Radius meters"
              />
            )}
            <div className="grid grid-cols-[1fr_auto_1fr] gap-1">
              <input
                value={filterField}
                onChange={(event) => setFilterField(event.target.value)}
                className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                placeholder="field"
              />
              <select
                value={filterOperator}
                onChange={(event) => setFilterOperator(event.target.value as typeof filterOperator)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
              >
                <option value="equals">=</option>
                <option value="in">in</option>
                <option value="exists">exists</option>
              </select>
              <input
                value={filterValue}
                onChange={(event) => setFilterValue(event.target.value)}
                disabled={filterOperator === 'exists'}
                className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground disabled:opacity-50"
                placeholder="value"
              />
            </div>
            {extraFilters.map((filter, index) => (
              <div key={index} className="grid grid-cols-[1fr_auto_1fr_auto] gap-1">
                <input
                  value={filter.field}
                  onChange={(event) =>
                    setExtraFilters((current) =>
                      current.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, field: event.target.value } : entry,
                      ),
                    )
                  }
                  className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                  placeholder="field"
                />
                <select
                  value={filter.operator}
                  onChange={(event) =>
                    setExtraFilters((current) =>
                      current.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, operator: event.target.value as typeof filter.operator } : entry,
                      ),
                    )
                  }
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  <option value="equals">=</option>
                  <option value="in">in</option>
                  <option value="exists">exists</option>
                </select>
                <input
                  value={filter.value}
                  onChange={(event) =>
                    setExtraFilters((current) =>
                      current.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, value: event.target.value } : entry,
                      ),
                    )
                  }
                  disabled={filter.operator === 'exists'}
                  className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground disabled:opacity-50"
                  placeholder="value"
                />
                <button
                  type="button"
                  onClick={() => setExtraFilters((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                  className="rounded-md border border-input px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  -
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setExtraFilters((current) => [...current, { field: '', operator: 'equals', value: '' }])}
              className="text-left text-[11px] font-medium text-cyan-700 hover:text-cyan-800 dark:text-cyan-300"
            >
              Add another filter
            </button>
          </>
        ) : (
          <textarea
            value={expression}
            onChange={(event) => setExpression(event.target.value)}
            className="min-h-16 w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs text-foreground"
            placeholder="Example: shadeGap * cimdComposite"
          />
        )}

        <div className="grid grid-cols-2 gap-1">
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value as typeof direction)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
          >
            <option value="higherIsBetter">Higher helps</option>
            <option value="higherIsWorse">Higher hurts</option>
          </select>
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
          >
            <option value="count">Count</option>
            <option value="density">Density</option>
            <option value="ratio">Ratio</option>
            <option value="percent">Percent</option>
            <option value="index">Index</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => {
            if (selectedIsCensus && selectedCensusPreset) {
              onCreate(censusPresetToMetricRecipe({ ...selectedCensusPreset, label: label.trim() || selectedCensusPreset.label }))
              return
            }
            const filters: MetricRecipeFilter[] = []
            if (!selectedIsFormula && filterField.trim()) {
              filters.push({
                field: filterField.trim(),
                operator: filterOperator,
                value: parseFilterValue(filterValue, filterOperator),
              })
            }
            extraFilters.forEach((filter) => {
              if (!filter.field.trim()) return
              filters.push({
                field: filter.field.trim(),
                operator: filter.operator,
                value: parseFilterValue(filter.value, filter.operator),
              })
            })
            onCreate({
              id: metricId || `custom_metric_${recipes.length + 1}`,
              label: label.trim() || 'Custom metric',
              source,
              operation: selectedIsFormula ? 'derivedExpression' : operation,
              radiusMeters,
              expression: selectedIsFormula ? expression : undefined,
              filters: filters.length ? filters : undefined,
              direction,
              format,
              proxyLevel: 'experimental',
              sourcePath: dataset?.path,
            })
          }}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Add recipe metric
        </button>
      </div>

      {recipes.length > 0 && (
        <div className="mt-3 space-y-1">
          {recipes.map((recipe) => (
            <div key={recipe.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{recipe.label}</div>
                <div className="truncate text-[10px] text-muted-foreground">{recipe.id}</div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(recipe.id)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Remove ${recipe.label}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
