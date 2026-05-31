import { BarChart3, BookOpen, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SCORE_PRESETS } from '../constants'
import type {
  ScoredBoundaryRegion,
  ScoreBandSummary,
  ScoreFilterKey,
  ScoreFilterState,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
  ScenarioComparison,
} from '../types'
import { formatScore } from '../lib/metrics'
import { getScorePresetMethodology } from '../constants'
import { SCORE_FILTER_DEFINITIONS } from './scoreBuilderPanelUtils'
import { MethodControls } from './MethodControls'

interface ModelTabProps {
  className?: string
  weights: ScoreMetricWeightMap
  totalAbsoluteWeight: number
  scoreFilters: ScoreFilterState
  onToggleScoreFilter: (filter: ScoreFilterKey) => void
  methodSettings: ScoreMethodSettings
  onMethodSettingsChange: (settings: ScoreMethodSettings) => void
  scoreBands: ScoreBandSummary[]
  scenarioComparison: ScenarioComparison | null
  regions: ScoredBoundaryRegion[]
  totalRegionCount: number
  excludedRegionCount: number
  scoreSpread: { min: number; max: number; average: number }
  activePreset?: (typeof SCORE_PRESETS)[number] | null
}

export function ModelTab({
  className,
  weights,
  totalAbsoluteWeight,
  scoreFilters,
  onToggleScoreFilter,
  methodSettings,
  onMethodSettingsChange,
  scoreBands,
  scenarioComparison,
  regions,
  totalRegionCount,
  excludedRegionCount,
  scoreSpread,
  activePreset = null,
}: ModelTabProps) {
  const activeFilters = SCORE_FILTER_DEFINITIONS.filter((filter) => scoreFilters[filter.key])
  const maxBandCount = Math.max(...scoreBands.map((band) => band.count), 1)
  const activeMetricCount = Object.values(weights).filter((weight) => weight !== 0).length
  const presetMethodology = activePreset ? getScorePresetMethodology(activePreset) : null
  const deprivationRegions = regions.filter((region) => region.equityAudit.deprivationQuintile !== null)
  const deprivationWeightedAverage = deprivationRegions.length
    ? deprivationRegions.reduce(
        (sum, region) => sum + region.score * (region.equityAudit.deprivationQuintile || 1),
        0,
      ) / deprivationRegions.reduce((sum, region) => sum + (region.equityAudit.deprivationQuintile || 1), 0)
    : null
  const topBurdenOverlap = [...regions]
    .sort((a, b) => b.equityAudit.burdenOverlap - a.equityAudit.burdenOverlap)
    .slice(0, 3)

  return (
    <div className={cn('space-y-3 p-4', className)} data-score-builder-section="model">
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-cyan-600" />
          <div className="text-sm font-semibold text-foreground">Methodology</div>
        </div>
        <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Each metric is automatically normalized from 0 to 1 with the selected method against the currently loaded
            regions. Positive weights prefer high normalized values; negative weights prefer low values.
          </p>
          <p>
            Scores are relative to the currently loaded boundary level; filters do not redefine percentiles. Use for
            planning triage, not validated exposure, health, or funding eligibility determination.
          </p>
          <p>
            The final score uses the selected aggregation method after active weights are converted to weight shares.
            EJI-style mode uses active metric weights only to select indicators; module ranks are weighted equally.
            Active weights are normalized by total influence, so a useful model can use any total.
          </p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Influence</div>
            <div className="font-semibold text-foreground">{totalAbsoluteWeight.toLocaleString()}</div>
          </div>
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Metrics</div>
            <div className="font-semibold text-foreground">{activeMetricCount}</div>
          </div>
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Average</div>
            <div className="font-semibold text-foreground">{formatScore(scoreSpread.average)}</div>
          </div>
        </div>
      </div>

      {presetMethodology && (
        <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
          <div className="mb-2 text-sm font-semibold text-foreground">Preset methodology notes</div>
          <div>
            <span className="font-semibold text-foreground">Purpose:</span> {presetMethodology.purpose}
          </div>
          <div className="mt-1">
            <span className="font-semibold text-foreground">Components:</span>{' '}
            {presetMethodology.components.join(', ') || 'Custom metric set'}
          </div>
          <div className="mt-1">
            <span className="font-semibold text-foreground">Normalization:</span> {presetMethodology.normalization}
          </div>
          {presetMethodology.proxy && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
              Proxy recipe. Use for screening, not as a validated exposure or health index.
            </div>
          )}
          <div className="mt-2">
            <div className="font-semibold text-foreground">Known limits</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {presetMethodology.knownLimits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          </div>
          <div className="mt-2">
            <div className="font-semibold text-foreground">Data still needed</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {presetMethodology.dataNeeded.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 text-sm font-semibold text-foreground">Equity audit</div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div>
            Deprivation-weighted average:{' '}
            <span className="font-semibold text-foreground">
              {deprivationWeightedAverage == null ? 'No CIMD data loaded' : formatScore(deprivationWeightedAverage)}
            </span>
          </div>
          <div className="space-y-1">
            {topBurdenOverlap.map((region) => (
              <div key={region.region.id} className="flex items-center justify-between rounded bg-muted/25 px-2 py-1">
                <span className="truncate">
                  #{region.rank} {region.region.name}
                </span>
                <span className="font-semibold text-foreground">
                  {(region.equityAudit.burdenOverlap * 100).toFixed(0)} overlap
                </span>
              </div>
            ))}
          </div>
          {regions.some((region) => region.equityAudit.cutoffWarning) && (
            <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
              Some regions sit near score-band cutoffs; treat hard thresholds as sensitive.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 text-sm font-semibold text-foreground">Method controls</div>
        <MethodControls
          weights={weights}
          methodSettings={methodSettings}
          onMethodSettingsChange={onMethodSettingsChange}
        />
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-semibold text-foreground">Hard filters</div>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {regions.length} of {totalRegionCount} eligible
          </span>
        </div>
        <div className="space-y-2">
          {SCORE_FILTER_DEFINITIONS.map((filter) => {
            const active = scoreFilters[filter.key]
            return (
              <button
                key={filter.key}
                type="button"
                data-score-builder-hard-filter={filter.key}
                onClick={() => onToggleScoreFilter(filter.key)}
                className={cn(
                  'flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                  active
                    ? 'border-cyan-500/60 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/35 dark:text-cyan-100'
                    : 'border-input bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                <span>
                  <span className="block text-xs font-semibold">{filter.label}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">{filter.description}</span>
                </span>
                <span className={cn('shrink-0 text-xs font-bold', active ? 'text-cyan-600' : 'text-muted-foreground')}>
                  {active ? 'ON' : 'OFF'}
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          {activeFilters.length
            ? `${excludedRegionCount} region${excludedRegionCount === 1 ? '' : 's'} excluded before ranking.`
            : 'No hard filters are active; all loaded regions remain eligible.'}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-semibold text-foreground">Score bands</div>
        </div>
        <div className="space-y-2">
          {scoreBands.map((band) => (
            <div key={band.key}>
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="font-semibold text-foreground">{band.label}</span>
                <span className="text-muted-foreground">{band.count} regions</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full',
                    band.key === 'high'
                      ? 'bg-emerald-500'
                      : band.key === 'moderate'
                        ? 'bg-cyan-500'
                        : band.key === 'low'
                          ? 'bg-amber-500'
                          : 'bg-rose-500',
                  )}
                  style={{ width: `${Math.max(3, (band.count / maxBandCount) * 100)}%` }}
                />
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {band.min}-{band.max} · {band.description}
              </div>
            </div>
          ))}
        </div>
      </div>

      {scenarioComparison && (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="mb-2 text-sm font-semibold text-amber-950 dark:text-amber-100">Scenario compare</div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-amber-900 dark:text-amber-100">
            <div className="rounded border border-amber-200/70 bg-white/50 p-2 dark:border-amber-900 dark:bg-amber-950/20">
              <div className="text-[10px] uppercase text-amber-700 dark:text-amber-300">Current top</div>
              <div className="font-semibold">{scenarioComparison.currentTopName || 'None'}</div>
              <div>{formatScore(scenarioComparison.currentTopScore)}</div>
            </div>
            <div className="rounded border border-amber-200/70 bg-white/50 p-2 dark:border-amber-900 dark:bg-amber-950/20">
              <div className="text-[10px] uppercase text-amber-700 dark:text-amber-300">{scenarioComparison.label}</div>
              <div className="font-semibold">{scenarioComparison.referenceTopName || 'None'}</div>
              <div>{formatScore(scenarioComparison.referenceTopScore)}</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-amber-800 dark:text-amber-200">
            Average delta vs {scenarioComparison.label}:{' '}
            <span className="font-semibold">
              {scenarioComparison.averageDelta >= 0 ? '+' : ''}
              {formatScore(scenarioComparison.averageDelta)}
            </span>
            {scenarioComparison.topChanged ? ' · top region changed' : ' · top region unchanged'}
            <br />
            Sensitivity: top area held in {(scenarioComparison.stableTopShare * 100).toFixed(0)}% of trials · avg rank
            shift {scenarioComparison.averageRankShift.toFixed(1)}
          </div>
          <div className="mt-2 grid gap-2 text-[11px] text-amber-900 dark:text-amber-100 sm:grid-cols-3">
            <div>
              <div className="font-semibold">Changed most</div>
              {scenarioComparison.changedMost.slice(0, 3).map((entry) => (
                <div key={entry.regionId} className="truncate">
                  {entry.regionName} {entry.delta >= 0 ? '+' : ''}
                  {formatScore(entry.delta)}
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold">Always high</div>
              {scenarioComparison.alwaysHighPriority.slice(0, 3).map((entry) => (
                <div key={entry.regionId} className="truncate">
                  {entry.regionName}
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold">Sensitive</div>
              {scenarioComparison.sensitiveRegions.slice(0, 3).map((entry) => (
                <div key={entry.regionId} className="truncate">
                  {entry.regionName} {entry.rankShift.toFixed(1)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-dashed border-border bg-muted/10 p-3 text-xs text-muted-foreground">
        Rubric mode is the next larger model change: metric values would be binned into named classes before weighting,
        similar to GIS-MCDA scoring matrices.
      </div>
    </div>
  )
}
