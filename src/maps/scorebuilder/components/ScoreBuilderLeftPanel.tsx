import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Layers, Plus, Trash2, Upload } from 'lucide-react'
import { DatasetInfo } from '@/components/DatasetInfo'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
import { getLevelOptionsForSource } from '@/lib/studyArea'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import { SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS } from '../constants'
import type { ScoreDataSource, ScoreMetricDefinition, ScoreMetricKey, ScoreMetricWeightMap } from '../types'
import { SCORE_DATA_SOURCES } from '../types'
import { getUnavailableWeightedMetrics } from '../lib/metrics'
import { InactiveTermNotice } from './ScoreBuilderBuildView'
import { MetricLibraryPanel } from './MetricLibrary'
import { SCORE_BUILDER_DATASETS, type DatasetProfile } from '../lib/datasetCatalog'
import type { MetricRecipe, MetricRecipeFilter, MetricRecipeOperation, MetricRecipeSource } from '../lib/metricRecipes'
import { isUserDatasetSource, userDatasetSourceId, type UserDatasetSummary } from '../lib/userDatasets'
import type { UserDatasetUploadResult } from '../hooks/useUserDatasets'
import { CENSUS_COMPOSER_PRESETS, censusPresetToMetricRecipe } from '../lib/censusComposer'

interface ScoreBuilderLeftPanelProps {
  className?: string
  boundarySource: BoundarySource
  onBoundarySourceChange: (source: BoundarySource) => void
  selectedRegionLevel: RegionLevel
  onRegionLevelChange: (level: RegionLevel) => void
  boundaryLevelOptions: Array<{ value: RegionLevel; label: string }>
  weights: ScoreMetricWeightMap
  /** Built-ins plus the user's recipe metrics. */
  metrics: ScoreMetricDefinition[]
  onAddMetric: (metric: ScoreMetricKey, value: number) => void
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  enabledDataSources: ScoreDataSource[]
  onToggleDataSource: (source: ScoreDataSource) => void
  onEnableDataSource: (source: ScoreDataSource) => void
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
  userDatasets: UserDatasetSummary[]
  onUploadUserDataset: (file: File, label: string) => Promise<UserDatasetUploadResult>
  onRemoveUserDataset: (id: string) => Promise<void> | void
}

export function ScoreBuilderLeftPanel({
  className,
  boundarySource,
  onBoundarySourceChange,
  selectedRegionLevel,
  onRegionLevelChange,
  boundaryLevelOptions,
  weights,
  metrics,
  onAddMetric,
  onWeightChange,
  enabledDataSources,
  onToggleDataSource,
  onEnableDataSource,
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
  userDatasets,
  onUploadUserDataset,
  onRemoveUserDataset,
}: ScoreBuilderLeftPanelProps) {
  // Open by default: the list is now a readout of what the equation switched on, so
  // hiding it would also hide it from the accessibility tree for no real gain.
  const [dataSourcesOpen, setDataSourcesOpen] = useState(true)
  const enabledSet = useMemo(() => new Set(enabledDataSources), [enabledDataSources])
  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])
  const displayedBoundarySource = canUseWalkabilitySourceSurface && mapSurface === 'source' ? undefined : boundarySource
  const unavailableTerms = useMemo(
    () => getUnavailableWeightedMetrics(metrics, weights, enabledDataSources, boundarySource),
    [boundarySource, enabledDataSources, metrics, weights],
  )

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
        <span className="ml-auto text-xs text-muted-foreground">{regionCount} regions</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" data-score-builder-scroll="true">
        <DatasetInfo dataset={DATASETS.scoreBuilder} />

        <StudyAreaSelector<BoundarySource, RegionLevel>
          source={displayedBoundarySource}
          sourceOptions={SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS}
          level={selectedRegionLevel}
          levelOptions={boundaryLevelOptions}
          levelOptionsForSource={getLevelOptionsForSource}
          onSourceChange={(source) => {
            onBoundarySourceChange(source)
            if (canUseWalkabilitySourceSurface) onMapSurfaceChange('boundary')
          }}
          onSelectedSourceClick={
            canUseWalkabilitySourceSurface ? () => onMapSurfaceChange('source') : undefined
          }
          onLevelChange={onRegionLevelChange}
          levelSelectId="score-builder-level"
          dataPrefix="score-builder"
        />

        <MetricLibraryPanel
          weights={weights}
          metrics={metrics}
          boundarySource={boundarySource}
          onAddMetric={onAddMetric}
          onRemoveMetric={(metric) => onWeightChange(metric, 0)}
          renderCategoryExtras={(category) =>
            category === 'airQuality' && enabledSet.has('airQuality') ? (
              <div className="mb-1.5 space-y-1 rounded-md border border-cyan-200 bg-cyan-50/40 p-2 dark:border-cyan-900 dark:bg-cyan-950/20">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{selectedNetworks.length} networks</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onSelectAllNetworks}
                      className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
                    >
                      All
                    </button>
                    <button
                      type="button"
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
                      type="button"
                      data-score-builder-network={network}
                      onClick={() => onToggleNetwork(network)}
                      className={cn(
                        'flex w-full items-center justify-between rounded px-2 py-1 text-xs transition-colors',
                        selectedNetworkSet.has(network)
                          ? 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-100'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <span className="truncate">{network}</span>
                      <span>{count.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null
          }
        />

        {/* Data sources follow the metrics in use; the list stays for overlay-only
            sources and for switching one back on after an explicit turn-off. */}
        <section className="border-t border-border p-4" data-score-builder-section="filters">
          <button
            type="button"
            onClick={() => setDataSourcesOpen((current) => !current)}
            aria-expanded={dataSourcesOpen}
            className="mb-2 flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Data sources · {enabledDataSources.length} on
            </span>
            {dataSourcesOpen ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>

          {unavailableTerms.size > 0 && (
            <div className="mb-2 space-y-1">
              {[...unavailableTerms].map(([key, unavailable]) => {
                const metric = metrics.find((entry) => entry.key === key)
                if (!metric) return null
                return (
                  <InactiveTermNotice
                    key={key}
                    metric={metric}
                    unavailable={unavailable}
                    onEnableDataSource={onEnableDataSource}
                  />
                )
              })}
            </div>
          )}

          <div className={cn('space-y-2', !dataSourcesOpen && 'hidden')}>
            {/* Point overlays draw from the data sources, not from the study-area
                boundaries, so the toggle lives with them. */}
            <button
              type="button"
              onClick={onTogglePoints}
              aria-pressed={showPoints}
              className={cn(
                'flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-left text-xs transition-colors',
                showPoints
                  ? 'border-sky-500/60 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100'
                  : 'border-input bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="min-w-0 truncate font-medium">Source points on map</span>
              <span className={cn('ml-2 shrink-0 font-semibold', showPoints ? 'text-sky-600' : 'text-muted-foreground')}>
                {showPoints ? 'ON' : 'OFF'}
              </span>
            </button>
            {SCORE_DATA_SOURCES.map((ds) => {
              const active = enabledSet.has(ds.id)
              const orphanedCount = [...unavailableTerms.values()].filter(
                (entry) => entry.source === ds.id,
              ).length
              return (
                <button
                  key={ds.id}
                  type="button"
                  aria-label={`${ds.label} ${ds.id === 'bcAssessment' ? 'Property' : ''} ${active ? 'ON' : 'OFF'}`}
                  title={ds.description}
                  onClick={() => onToggleDataSource(ds.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-left text-xs transition-colors',
                    active
                      ? 'border-cyan-500/60 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100'
                      : orphanedCount > 0
                        ? 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100'
                        : 'border-input bg-background text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="min-w-0 truncate font-medium">{ds.label}</span>
                  <span className="ml-2 flex shrink-0 items-center gap-1.5 text-xs font-semibold">
                    {orphanedCount > 0 && !active && (
                      <span className="inline-flex items-center gap-1 font-normal">
                        <AlertTriangle className="h-3 w-3" />
                        {orphanedCount} metric{orphanedCount === 1 ? '' : 's'}
                      </span>
                    )}
                    <span className={active ? 'text-cyan-600' : 'text-muted-foreground'}>{active ? 'ON' : 'OFF'}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <CustomMetricBuilder
          recipes={customMetricRecipes}
          datasetProfiles={datasetProfiles}
          onCreate={onCreateCustomMetric}
          onRemove={onRemoveCustomMetric}
          userDatasets={userDatasets}
          onUploadUserDataset={onUploadUserDataset}
          onRemoveUserDataset={onRemoveUserDataset}
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

const metricSelectTriggerClass = 'h-8 border-input bg-background px-2 py-1.5 text-xs text-foreground'
const filterOperatorOptions = [
  { value: 'equals', label: '=' },
  { value: 'in', label: 'in' },
  { value: 'exists', label: 'exists' },
]

export function CustomMetricBuilder({
  recipes,
  datasetProfiles,
  onCreate,
  onRemove,
  userDatasets,
  onUploadUserDataset,
  onRemoveUserDataset,
}: {
  recipes: MetricRecipe[]
  datasetProfiles: Partial<Record<MetricRecipeSource, DatasetProfile>>
  onCreate: (recipe: MetricRecipe) => void
  onRemove: (id: string) => void
  userDatasets: UserDatasetSummary[]
  onUploadUserDataset: (file: File, label: string) => Promise<UserDatasetUploadResult>
  onRemoveUserDataset: (id: string) => Promise<void> | void
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
  // Both heavy forms stay collapsed until needed so the panel reads as a short list.
  const [uploadsOpen, setUploadsOpen] = useState(false)
  const [builderOpen, setBuilderOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadLabel, setUploadLabel] = useState('')
  const [uploadStatus, setUploadStatus] = useState<{ tone: 'info' | 'error'; message: string } | null>(null)
  const [uploading, setUploading] = useState(false)

  const dataset = SCORE_BUILDER_DATASETS.find((entry) => entry.id === source)
  const selectedUserDataset = isUserDatasetSource(source)
    ? userDatasets.find((entry) => userDatasetSourceId(entry.id) === source)
    : undefined
  const profile = datasetProfiles[source]
  const metricId = slugifyMetricId(label || 'custom_metric')
  const selectedIsFormula = source === 'custom' || operation === 'derivedExpression'
  const selectedIsCensus = source === 'census'
  const selectedCensusPreset = CENSUS_COMPOSER_PRESETS.find((preset) => preset.id === censusPresetId) ?? CENSUS_COMPOSER_PRESETS[0]
  const sourceOptions = [
    ...SCORE_BUILDER_DATASETS.map((entry) => ({ value: entry.id, label: entry.label })),
    ...userDatasets.map((entry) => ({ value: userDatasetSourceId(entry.id), label: `${entry.label} (uploaded)` })),
  ]

  const handleUploadFile = async (file: File | null | undefined) => {
    if (!file) return
    setUploading(true)
    setUploadStatus(null)
    try {
      const result = await onUploadUserDataset(file, uploadLabel)
      setUploadLabel('')
      setSource(userDatasetSourceId(result.summary.id))
      if (operation === 'derivedExpression' || operation === 'censusVariable') setOperation('pointCountInPolygon')
      // Clear the prefilled education filter so it doesn't silently zero out the upload.
      setFilterField('')
      setFilterValue('')
      setBuilderOpen(true)
      setUploadStatus({
        tone: 'info',
        message:
          `${result.summary.featureCount.toLocaleString()} points loaded from ${file.name}.` +
          (result.warnings.length ? ` ${result.warnings.join(' ')}` : ''),
      })
    } catch (cause) {
      setUploadStatus({ tone: 'error', message: cause instanceof Error ? cause.message : 'Upload failed.' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <section className="border-t border-border p-4">
      <button
        type="button"
        onClick={() => setUploadsOpen((current) => !current)}
        aria-expanded={uploadsOpen}
        className="mb-2 flex w-full items-center justify-between gap-2 text-left"
        data-score-builder-uploads-toggle="true"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your data (this device){userDatasets.length > 0 ? ` · ${userDatasets.length}` : ''}
        </span>
        {uploadsOpen ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {uploadsOpen && (
      <div className="space-y-2 rounded-md border border-border bg-card p-3" data-score-builder-user-uploads="true">
        <p className="text-xs text-muted-foreground">
          Upload GeoJSON or CSV (with lat/lon columns) point data to use in custom metrics. Files are stored in this
          browser only and are not included in shared URLs.
        </p>
        <input
          value={uploadLabel}
          onChange={(event) => setUploadLabel(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
          placeholder="Dataset name (optional, defaults to file name)"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".geojson,.json,.csv,.tsv,application/geo+json,application/json,text/csv"
          className="hidden"
          onChange={(event) => void handleUploadFile(event.target.files?.[0])}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-input px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-cyan-400 hover:text-foreground disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {uploading ? 'Parsing…' : 'Choose file (.geojson, .json, .csv)'}
        </button>
        {uploadStatus && (
          <div
            className={cn(
              'rounded border p-2 text-xs',
              uploadStatus.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200',
            )}
          >
            {uploadStatus.message}
          </div>
        )}
        {userDatasets.length > 0 && (
          <div className="space-y-1">
            {userDatasets.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{entry.label}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {entry.featureCount.toLocaleString()} points · {entry.fileName}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onRemoveUserDataset(entry.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Delete uploaded dataset ${entry.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      <button
        type="button"
        onClick={() => setBuilderOpen((current) => !current)}
        aria-expanded={builderOpen}
        className="mb-2 mt-4 flex w-full items-center justify-between gap-2 text-left"
        data-score-builder-recipe-toggle="true"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Custom metric recipe
        </span>
        {builderOpen ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {builderOpen && (
      <div className="space-y-2 rounded-md border border-border bg-card p-3">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
          placeholder="Metric label"
        />
        <AppSelect
          value={source}
          onValueChange={(nextValue) => {
            const next = nextValue as MetricRecipeSource
            setSource(next)
            if (next === 'custom') setOperation('derivedExpression')
            else if (next === 'census') {
              setOperation('censusVariable')
              setFormat('percent')
              setDirection(selectedCensusPreset?.direction ?? 'higherIsWorse')
              setLabel(selectedCensusPreset?.label ?? 'Census demographic metric')
            } else if (operation === 'derivedExpression' || operation === 'censusVariable') {
              setOperation('pointCountInPolygon')
            }
            if (isUserDatasetSource(next)) {
              // The prefilled education filter would silently zero out uploaded data.
              setFilterField('')
              setFilterValue('')
            }
          }}
          options={sourceOptions}
          triggerClassName={metricSelectTriggerClass}
          triggerAriaLabel="Metric data source"
        />
        <div className="text-xs text-muted-foreground">
          {selectedUserDataset
            ? `Uploaded ${selectedUserDataset.fileName} — stored on this device; recipes built from it compute locally and are not reproducible from a shared URL.`
            : dataset?.description}
        </div>

        {profile && source !== 'custom' && (
          <div className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
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
            <AppSelect
              value={censusPresetId}
              onValueChange={(nextValue) => {
                const preset = CENSUS_COMPOSER_PRESETS.find((entry) => entry.id === nextValue)
                setCensusPresetId(nextValue)
                if (preset) {
                  setLabel(preset.label)
                  setDirection(preset.direction)
                  setFormat(preset.format)
                }
              }}
              options={CENSUS_COMPOSER_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
              triggerClassName={metricSelectTriggerClass}
              triggerAriaLabel="Census preset"
            />
            <div className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
              {selectedCensusPreset?.description}
            </div>
          </>
        ) : !selectedIsFormula ? (
          <>
            <AppSelect
              value={operation}
              onValueChange={(nextValue) => setOperation(nextValue as MetricRecipeOperation)}
              options={[
                { value: 'pointCountInPolygon', label: 'Count inside boundary' },
                { value: 'pointDensityInPolygon', label: 'Density inside boundary' },
                { value: 'countWithinCentroidRadius', label: 'Count within centroid radius' },
                { value: 'accessWithinCentroidRadius', label: 'Access within centroid radius' },
                { value: 'averagePropertyInPolygon', label: 'Average property inside boundary' },
              ]}
              triggerClassName={metricSelectTriggerClass}
              triggerAriaLabel="Metric operation"
            />
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
              <AppSelect
                value={filterOperator}
                onValueChange={(nextValue) => setFilterOperator(nextValue as typeof filterOperator)}
                options={filterOperatorOptions}
                triggerClassName={metricSelectTriggerClass}
                triggerAriaLabel="Filter operator"
              />
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
                <AppSelect
                  value={filter.operator}
                  onValueChange={(nextValue) =>
                    setExtraFilters((current) =>
                      current.map((entry, entryIndex) =>
                        entryIndex === index ? { ...entry, operator: nextValue as typeof filter.operator } : entry,
                      ),
                    )
                  }
                  options={filterOperatorOptions}
                  triggerClassName={metricSelectTriggerClass}
                  triggerAriaLabel="Extra filter operator"
                />
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
              className="text-left text-xs font-medium text-cyan-700 hover:text-cyan-800 dark:text-cyan-300"
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
          <AppSelect
            value={direction}
            onValueChange={(nextValue) => setDirection(nextValue as typeof direction)}
            options={[
              { value: 'higherIsBetter', label: 'Higher helps' },
              { value: 'higherIsWorse', label: 'Higher hurts' },
            ]}
            triggerClassName={metricSelectTriggerClass}
            triggerAriaLabel="Metric direction"
          />
          <AppSelect
            value={format}
            onValueChange={(nextValue) => setFormat(nextValue as typeof format)}
            options={[
              { value: 'count', label: 'Count' },
              { value: 'density', label: 'Density' },
              { value: 'ratio', label: 'Ratio' },
              { value: 'percent', label: 'Percent' },
              { value: 'index', label: 'Index' },
            ]}
            triggerClassName={metricSelectTriggerClass}
            triggerAriaLabel="Metric format"
          />
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
      )}

      {recipes.length > 0 && (
        <div className="mt-3 space-y-1">
          {recipes.map((recipe) => (
            <div key={recipe.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{recipe.label}</div>
                <div className="truncate text-xs text-muted-foreground">{recipe.id}</div>
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
