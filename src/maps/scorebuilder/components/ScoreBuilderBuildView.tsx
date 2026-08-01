import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Download,
  Hammer,
  Map as MapIcon,
  Settings as SettingsIcon,
  X,
} from 'lucide-react'
import type { AirMonitor, BoundarySource, RegionLevel } from '@/maps/airquality'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { Slider } from '@/components/ui/slider'
import { getLevelOptionsForSource } from '@/lib/studyArea'
import { cn } from '@/lib/utils'
import { SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS, SCORE_PRESETS } from '../constants'
import { getUnavailableWeightedMetrics, type MetricAvailability } from '../lib/metrics'
import { MetricLibraryPanel } from './MetricLibrary'
import { formatScore } from '../lib/metrics'
import type {
  BaselineComparisonResult,
  BaselineSnapshot,
} from '../lib/baselineComparison'
import type {
  ScoredBoundaryRegion,
  ScoreDataSource,
  ScoreMetricDefinition,
  ScoreMetricKey,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
} from '../types'
import { BaselineComparisonCard } from './BaselineComparisonCard'
import { WeightDistribution } from './EquationComposer'
import { MethodControls } from './MethodControls'
import { ScoreBuilderMap } from './ScoreBuilderMap'
import { ScorePresetDialog } from './ScorePresetDialog'
import { clampWeight, getCategoryTone } from './scoreBuilderPanelUtils'

export interface ScoreBuilderBuildViewProps {
  weights: ScoreMetricWeightMap
  /** Built-ins plus the user's recipe metrics. */
  metrics: ScoreMetricDefinition[]
  enabledDataSources: ScoreDataSource[]
  onEnableDataSource: (source: ScoreDataSource) => void
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  onAddMetric: (metric: ScoreMetricKey, value: number) => void
  totalAbsoluteWeight: number
  methodSettings: ScoreMethodSettings
  onMethodSettingsChange: (settings: ScoreMethodSettings) => void
  boundarySource: BoundarySource
  onBoundarySourceChange: (source: BoundarySource) => void
  selectedRegionLevel: RegionLevel
  onRegionLevelChange: (level: RegionLevel) => void
  boundaryLevelOptions: Array<{ value: RegionLevel; label: string }>
  equationPreview: string
  scoreSpread: { min: number; max: number; average: number }
  scoredRegions: ScoredBoundaryRegion[]
  loading: boolean
  activeRecipeLabel: string
  activeRecipeDescription: string
  activePresetKey: string | null
  onApplyPreset: (presetKey: string) => void
  baseline: BaselineSnapshot | null
  baselineComparison: BaselineComparisonResult | null
  onPinBaseline: () => void
  onClearBaseline: () => void
  monitors: AirMonitor[]
  showPoints: boolean
  regionFillColors: Record<string, string> | null
  onSwitchToExplore: () => void
  onOpenSettings: () => void
  onExportProjectPackage: (label: string) => void
}

/**
 * Full-width "Build" mode for the Index Lab: metric library, equation canvas with the
 * method pipeline inline, and a live preview column. Shares all state with the map-first
 * "Explore" mode — only the layout changes.
 */
export function ScoreBuilderBuildView({
  weights,
  metrics,
  enabledDataSources,
  onEnableDataSource,
  onWeightChange,
  onAddMetric,
  totalAbsoluteWeight,
  methodSettings,
  onMethodSettingsChange,
  boundarySource,
  onBoundarySourceChange,
  selectedRegionLevel,
  onRegionLevelChange,
  boundaryLevelOptions,
  equationPreview,
  scoreSpread,
  scoredRegions,
  loading,
  activeRecipeLabel,
  activeRecipeDescription,
  activePresetKey,
  onApplyPreset,
  baseline,
  baselineComparison,
  onPinBaseline,
  onClearBaseline,
  monitors,
  showPoints,
  regionFillColors,
  onSwitchToExplore,
  onOpenSettings,
  onExportProjectPackage,
}: ScoreBuilderBuildViewProps) {
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const activeTerms = useMemo(() => metrics.filter((metric) => weights[metric.key] !== 0), [metrics, weights])
  const unavailableTerms = useMemo(
    () => getUnavailableWeightedMetrics(metrics, weights, enabledDataSources, boundarySource),
    [boundarySource, enabledDataSources, metrics, weights],
  )
  const topRegions = scoredRegions.slice(0, 5)

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      <IndexLabHeader
        mode="build"
        onSwitchToExplore={onSwitchToExplore}
        title={activeRecipeLabel}
        description={activeRecipeDescription}
        onOpenPresets={() => setPresetDialogOpen(true)}
        onExportPackage={() => onExportProjectPackage(activeRecipeLabel)}
        onOpenSettings={onOpenSettings}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)_minmax(19rem,24rem)] lg:overflow-hidden">
        <MetricLibraryPanel
          weights={weights}
          metrics={metrics}
          boundarySource={boundarySource}
          onAddMetric={onAddMetric}
          onRemoveMetric={(metric) => onWeightChange(metric, 0)}
          className="order-2 border-b border-border lg:order-none lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r"
        />

        <div className="order-1 space-y-3 border-b border-border p-4 lg:order-none lg:min-h-0 lg:overflow-y-auto lg:border-b-0">
          <StudyAreaSelector<BoundarySource, RegionLevel>
            source={boundarySource}
            sourceOptions={SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS}
            level={selectedRegionLevel}
            levelOptions={boundaryLevelOptions}
            levelOptionsForSource={getLevelOptionsForSource}
            onSourceChange={onBoundarySourceChange}
            onLevelChange={onRegionLevelChange}
            sectionClassName="rounded-lg border border-border bg-background p-3"
            dataPrefix="score-builder-build"
          />

          <section className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Equation</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Slide how much each metric matters. The +/− toggle sets whether high values raise or lower the score.
              </div>
            </div>
            <WeightDistribution weights={weights} totalAbsoluteWeight={totalAbsoluteWeight} metrics={metrics} />

            {activeTerms.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                No active metrics. Pick one from the library to start the equation.
              </div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {activeTerms.map((metric) => (
                  <CompactWeightRow
                    key={metric.key}
                    metric={metric}
                    value={weights[metric.key]}
                    totalAbsoluteWeight={totalAbsoluteWeight}
                    unavailable={unavailableTerms.get(metric.key) ?? null}
                    onEnableDataSource={onEnableDataSource}
                    onChange={(value) => onWeightChange(metric.key, value)}
                    onRemove={() => onWeightChange(metric.key, 0)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Method pipeline
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span className="rounded-md border border-border bg-muted/30 px-2 py-1">1 · Normalize each metric</span>
              <span aria-hidden="true">→</span>
              <span className="rounded-md border border-border bg-muted/30 px-2 py-1">2 · Apply weights</span>
              <span aria-hidden="true">→</span>
              <span className="rounded-md border border-border bg-muted/30 px-2 py-1">3 · Aggregate to a score</span>
            </div>
            <MethodControls
              weights={weights}
              metrics={metrics}
              methodSettings={methodSettings}
              onMethodSettingsChange={onMethodSettingsChange}
            />
          </section>

          <section className="rounded-lg border border-border bg-background p-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Formula</div>
            <div className="font-mono text-xs text-foreground">{equationPreview}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              |weights| sum: {totalAbsoluteWeight.toLocaleString()} — weights are divided by total influence, so they
              do not need to equal 100.
            </div>
          </section>
        </div>

        <div className="order-3 space-y-3 p-4 lg:order-none lg:min-h-0 lg:overflow-y-auto lg:border-l">
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Live preview
              </div>
              <button
                type="button"
                onClick={onSwitchToExplore}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <MapIcon className="h-3.5 w-3.5" />
                Open full map
              </button>
            </div>
            <div className="relative h-64">
              <ScoreBuilderMap
                regions={scoredRegions}
                selectedRegionId={null}
                monitors={monitors}
                showPoints={showPoints}
                onRegionClick={() => onSwitchToExplore()}
                regionFillColors={regionFillColors}
                loading={loading}
              />
            </div>
          </section>

          <section className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Live results
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {topRegions[0] ? `#1 ${topRegions[0].region.name}` : 'No ranked regions yet'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold leading-none text-cyan-700 dark:text-cyan-300">
                  {topRegions[0] ? formatScore(topRegions[0].score) : '0.0'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Avg {formatScore(scoreSpread.average)}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded border border-border bg-muted/20 p-2">
                <div className="text-xs uppercase text-muted-foreground">Low</div>
                <div className="font-semibold text-foreground">{formatScore(scoreSpread.min)}</div>
              </div>
              <div className="rounded border border-border bg-muted/20 p-2">
                <div className="text-xs uppercase text-muted-foreground">High</div>
                <div className="font-semibold text-foreground">{formatScore(scoreSpread.max)}</div>
              </div>
              <div className="rounded border border-border bg-muted/20 p-2">
                <div className="text-xs uppercase text-muted-foreground">Regions</div>
                <div className="font-semibold text-foreground">{scoredRegions.length.toLocaleString()}</div>
              </div>
            </div>
            {topRegions.length > 1 && (
              <div className="mt-3 space-y-1">
                {topRegions.map((region) => (
                  <div key={region.region.id} className="flex items-center gap-2 text-xs">
                    <span className="w-6 shrink-0 font-semibold text-muted-foreground">#{region.rank}</span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{region.region.name}</span>
                    <span className="font-semibold text-cyan-700 dark:text-cyan-300">{formatScore(region.score)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <BaselineComparisonCard
            baseline={baseline}
            comparison={baselineComparison}
            onPinBaseline={onPinBaseline}
            onClearBaseline={onClearBaseline}
          />
        </div>
      </div>

      <ScorePresetDialog
        open={presetDialogOpen}
        onOpenChange={setPresetDialogOpen}
        presets={SCORE_PRESETS}
        activePresetKey={activePresetKey}
        onApplyPreset={onApplyPreset}
      />
    </div>
  )
}

/**
 * Shared Index Lab header strip: view toggle, recipe title, and the
 * Presets / Package / Settings actions. Both the Build and Explore views render
 * this exact bar so the toggle and buttons never move when swapping views.
 */
export function IndexLabHeader({
  mode,
  onSwitchToBuild,
  onSwitchToExplore,
  title,
  description,
  onOpenPresets,
  onExportPackage,
  onOpenSettings,
}: {
  mode: 'build' | 'explore'
  onSwitchToBuild?: () => void
  onSwitchToExplore?: () => void
  title: string
  description: string
  onOpenPresets: () => void
  onExportPackage: () => void
  onOpenSettings: () => void
}) {
  return (
    // On mobile the app navbar is a fixed overlay of floating pills, so the header's
    // solid background extends up behind them instead of leaving a see-through gap.
    <header
      data-index-lab-header="true"
      className="shrink-0 border-b border-border bg-background max-md:pt-[calc(env(safe-area-inset-top)+3.25rem)]"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4">
        <ViewModeToggle mode={mode} onSwitchToBuild={onSwitchToBuild} onSwitchToExplore={onSwitchToExplore} />
        <div className="hidden min-w-0 flex-1 md:block">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          <p className="line-clamp-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenPresets}
            title="Browse presets and projects"
            aria-label="Browse presets and projects"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Presets</span>
          </button>
          <button
            type="button"
            onClick={onExportPackage}
            title="Download the current recipe as a project package file"
            aria-label="Download project package"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Package</span>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="Advanced settings — examples, saved indexes, robustness"
            aria-label="Open advanced settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:text-foreground"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="w-full min-w-0 md:hidden">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          <p className="line-clamp-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </header>
  )
}

/** Segmented Build / Explore switch shared by both modes' headers. */
export function ViewModeToggle({
  mode,
  onSwitchToBuild,
  onSwitchToExplore,
  className,
}: {
  mode: 'build' | 'explore'
  onSwitchToBuild?: () => void
  onSwitchToExplore?: () => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label="Lab view"
      className={cn('inline-flex h-8 items-stretch overflow-hidden rounded-md border border-input bg-background', className)}
    >
      <button
        type="button"
        aria-pressed={mode === 'build'}
        title="Build view — compose the index full-width"
        onClick={mode === 'build' ? undefined : onSwitchToBuild}
        className={cn(
          'inline-flex items-center gap-1 px-2.5 text-xs font-medium transition-colors',
          mode === 'build' ? 'bg-cyan-500 text-white' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Hammer className="h-3.5 w-3.5" />
        Build
      </button>
      <button
        type="button"
        aria-pressed={mode === 'explore'}
        title="Explore view — map-first with regions, density, and correlate"
        onClick={mode === 'explore' ? undefined : onSwitchToExplore}
        className={cn(
          'inline-flex items-center gap-1 border-l border-input px-2.5 text-xs font-medium transition-colors',
          mode === 'explore' ? 'bg-cyan-500 text-white' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <MapIcon className="h-3.5 w-3.5" />
        Explore
      </button>
    </div>
  )
}

/**
 * One-line weight editor, OECD Better Life Index style: a small direction toggle plus a
 * 0-100 importance slider, with the normalized share readout. Replaces the signed
 * slider card so five metrics read like a list instead of a wall.
 */
function CompactWeightRow({
  metric,
  value,
  totalAbsoluteWeight,
  unavailable,
  onEnableDataSource,
  onChange,
  onRemove,
}: {
  metric: ScoreMetricDefinition
  value: number
  totalAbsoluteWeight: number
  unavailable?: MetricAvailability | null
  onEnableDataSource?: (source: ScoreDataSource) => void
  onChange: (value: number) => void
  onRemove: () => void
}) {
  const clamped = clampWeight(value)
  const magnitude = Math.abs(clamped)
  const positive = clamped > 0
  const share = totalAbsoluteWeight > 0 ? Math.round((magnitude / totalAbsoluteWeight) * 100) : 0

  const applyMagnitude = (nextMagnitude: number) => {
    const next = Math.max(1, Math.min(100, Math.round(nextMagnitude)))
    onChange(positive ? next : -next)
  }

  return (
    <div>
    {unavailable && (
      <InactiveTermNotice
        metric={metric}
        unavailable={unavailable}
        onEnableDataSource={onEnableDataSource}
        className="mb-1"
      />
    )}
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-2 py-1.5 sm:flex-nowrap',
        unavailable && 'border-dashed opacity-60',
      )}
    >
      <button
        type="button"
        onClick={() => onChange(-clamped)}
        title={
          positive
            ? 'Counts up — high values raise the score. Click to flip.'
            : 'Counts down — high values lower the score. Click to flip.'
        }
        aria-label={`Flip direction for ${metric.shortLabel}`}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs font-bold',
          positive
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
            : 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300',
        )}
      >
        {positive ? '+' : '−'}
      </button>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', getCategoryTone(metric.category))} aria-hidden="true" />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs font-medium text-foreground sm:w-40 sm:flex-none',
          unavailable && 'text-muted-foreground line-through',
        )}
        title={`${metric.label} — ${share}% of the score`}
      >
        {metric.shortLabel}
      </span>
      <Slider
        min={1}
        max={100}
        step={1}
        value={[magnitude]}
        onValueChange={([next]) => applyMagnitude(next ?? magnitude)}
        aria-label={`${metric.shortLabel} importance`}
        className="order-last basis-full pb-1 sm:order-none sm:min-w-0 sm:flex-1 sm:basis-0 sm:pb-0"
      />
      <input
        type="number"
        min={1}
        max={100}
        step={1}
        value={magnitude}
        onChange={(event) => {
          const parsed = Number.parseFloat(event.target.value)
          if (Number.isFinite(parsed)) applyMagnitude(parsed)
        }}
        aria-label={`${metric.shortLabel} weight`}
        className="w-11 shrink-0 rounded border border-input bg-background px-1 py-0.5 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
      />
      <button
        type="button"
        onClick={onRemove}
        title="Remove metric"
        aria-label={`Remove ${metric.shortLabel}`}
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
    </div>
  )
}

/**
 * Explains why a weighted metric is contributing nothing. A switched-off data
 * source is recoverable inline; a boundary mismatch needs a different study area,
 * so that case only states the requirement.
 */
export function InactiveTermNotice({
  metric,
  unavailable,
  onEnableDataSource,
  className,
}: {
  metric: ScoreMetricDefinition
  unavailable: MetricAvailability
  onEnableDataSource?: (source: ScoreDataSource) => void
  className?: string
}) {
  const source = unavailable.source
  return (
    <div
      data-score-builder-inactive-term={metric.key}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md border border-amber-300/70 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100',
        className,
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{metric.shortLabel}</span> {unavailable.message}
      </span>
      {source && onEnableDataSource && (
        <button
          type="button"
          onClick={() => onEnableDataSource(source)}
          className="shrink-0 rounded border border-amber-400 bg-background px-2 py-0.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-950/60"
        >
          Turn on
        </button>
      )}
    </div>
  )
}

