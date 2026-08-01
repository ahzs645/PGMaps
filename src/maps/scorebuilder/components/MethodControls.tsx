import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  HEALTHYPLAN_PAIRWISE_PRESETS,
  SCORE_ACCESS_THRESHOLD_METRICS,
  SCORE_INDEX_MODULE_LABELS,
  SCORE_METRICS,
} from '../constants'
import type {
  ScoreIndexModule,
  ScoreMetricDefinition,
  ScoreMetricKey,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
} from '../types'
import { isHealthyPlanDemographicMetric, isHealthyPlanEnvironmentMetric } from './scoreBuilderPanelUtils'

interface MethodControlsProps {
  className?: string
  weights: ScoreMetricWeightMap
  /** Built-ins plus the user's recipe metrics, so custom terms are editable here too. */
  metrics?: ScoreMetricDefinition[]
  methodSettings: ScoreMethodSettings
  onMethodSettingsChange: (settings: ScoreMethodSettings) => void
}

export function MethodControls({
  className,
  weights,
  metrics = SCORE_METRICS,
  methodSettings,
  onMethodSettingsChange,
}: MethodControlsProps) {
  const healthyPlanDemographicMetrics = metrics.filter(isHealthyPlanDemographicMetric)
  const healthyPlanEnvironmentMetrics = metrics.filter(isHealthyPlanEnvironmentMetric)
  const activeHealthyPlanPairKey =
    HEALTHYPLAN_PAIRWISE_PRESETS.find(
      (preset) =>
        preset.demographicMetric === methodSettings.healthyPlanPriority.demographicMetric &&
        preset.environmentMetric === methodSettings.healthyPlanPriority.environmentMetric,
    )?.key ?? 'custom'

  const updateMethodSettings = <Key extends keyof ScoreMethodSettings>(key: Key, value: ScoreMethodSettings[Key]) =>
    onMethodSettingsChange({ ...methodSettings, [key]: value })

  return (
    <div className={cn('grid gap-2 text-xs', className)}>
      <label className="space-y-1">
        <span className="block font-medium text-muted-foreground">Normalization</span>
        <AppSelect
          value={methodSettings.normalization}
          onValueChange={(value) =>
            updateMethodSettings('normalization', value as ScoreMethodSettings['normalization'])
          }
          options={[
            { value: 'percentile', label: 'Percentile rank' },
            { value: 'winsorizedMinMax', label: 'Winsorized min-max' },
            { value: 'minMax', label: 'Min-max' },
            { value: 'zScore', label: 'Z-score' },
          ]}
          triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
        />
      </label>

      <label className="space-y-1">
        <span className="block font-medium text-muted-foreground">Aggregation</span>
        <AppSelect
          value={methodSettings.aggregation}
          onValueChange={(value) => updateMethodSettings('aggregation', value as ScoreMethodSettings['aggregation'])}
          options={[
            { value: 'additive', label: 'Weighted average' },
            { value: 'geometric', label: 'Geometric mean' },
            { value: 'cumulativeBurden', label: 'Cumulative burden' },
            { value: 'modulePercentileRankedSum', label: 'EJI-style module ranked sum' },
            { value: 'healthyPlanPairwisePriority', label: 'HealthyPlan-style pairwise priority' },
            { value: 'accessThreshold', label: 'Access threshold score' },
          ]}
          triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
        />
      </label>

      {methodSettings.aggregation === 'healthyPlanPairwisePriority' && (
        <div className="grid gap-2 rounded-md border border-amber-200 bg-amber-50/70 p-2 dark:border-amber-900/70 dark:bg-amber-950/25">
          <label className="space-y-1">
            <span className="block font-medium text-amber-950 dark:text-amber-100">Pairwise recipe</span>
            <AppSelect
              value={activeHealthyPlanPairKey}
              onValueChange={(value) => {
                if (value === 'custom') return
                const preset = HEALTHYPLAN_PAIRWISE_PRESETS.find((entry) => entry.key === value)
                if (!preset) return
                updateMethodSettings('healthyPlanPriority', {
                  demographicMetric: preset.demographicMetric,
                  environmentMetric: preset.environmentMetric,
                })
              }}
              options={[
                ...HEALTHYPLAN_PAIRWISE_PRESETS.map((preset) => ({
                  value: preset.key,
                  label: preset.label,
                })),
                { value: 'custom', label: 'Custom pair' },
              ]}
              triggerClassName="h-8 rounded border-amber-300 text-xs focus:ring-1 focus:ring-amber-500 dark:border-amber-900"
            />
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-amber-950 dark:text-amber-100">Vulnerable population proxy</span>
            <AppSelect
              value={methodSettings.healthyPlanPriority.demographicMetric ?? ''}
              onValueChange={(value) =>
                updateMethodSettings('healthyPlanPriority', {
                  ...methodSettings.healthyPlanPriority,
                  demographicMetric: value as ScoreMetricKey,
                })
              }
              options={healthyPlanDemographicMetrics.map((metric) => ({ value: metric.key, label: metric.label }))}
              triggerClassName="h-8 rounded border-amber-300 text-xs focus:ring-1 focus:ring-amber-500 dark:border-amber-900"
            />
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-amber-950 dark:text-amber-100">Built environment proxy</span>
            <AppSelect
              value={methodSettings.healthyPlanPriority.environmentMetric ?? ''}
              onValueChange={(value) =>
                updateMethodSettings('healthyPlanPriority', {
                  ...methodSettings.healthyPlanPriority,
                  environmentMetric: value as ScoreMetricKey,
                })
              }
              options={healthyPlanEnvironmentMetrics.map((metric) => ({ value: metric.key, label: metric.label }))}
              triggerClassName="h-8 rounded border-amber-300 text-xs focus:ring-1 focus:ring-amber-500 dark:border-amber-900"
            />
          </label>
          <p className="text-xs leading-snug text-amber-900 dark:text-amber-100/85">
            This applies the HealthyPlan threshold to the selected pair; it is a screening mode, not a weighted
            composite score.
          </p>
        </div>
      )}

      {methodSettings.aggregation === 'accessThreshold' && (
        <div className="grid gap-2 rounded-md border border-emerald-200 bg-emerald-50/70 p-2 dark:border-emerald-900/70 dark:bg-emerald-950/25">
          <label className="space-y-1">
            <span className="block font-medium text-emerald-950 dark:text-emerald-100">Access threshold</span>
            <input
              type="number"
              min={5}
              max={100}
              step={5}
              value={Math.round(methodSettings.accessThreshold.minimumAccess * 100)}
              onChange={(event) =>
                updateMethodSettings('accessThreshold', {
                  ...methodSettings.accessThreshold,
                  minimumAccess: Math.max(0.05, Math.min(1, Number(event.target.value) / 100)),
                })
              }
              className="h-8 rounded border border-emerald-300 bg-background px-2 text-xs dark:border-emerald-900"
            />
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-emerald-950 dark:text-emerald-100">Required access hits</span>
            <input
              type="number"
              min={1}
              max={SCORE_ACCESS_THRESHOLD_METRICS.length}
              value={methodSettings.accessThreshold.minimumHits}
              onChange={(event) =>
                updateMethodSettings('accessThreshold', {
                  ...methodSettings.accessThreshold,
                  minimumHits: Math.max(1, Math.min(SCORE_ACCESS_THRESHOLD_METRICS.length, Number(event.target.value))),
                })
              }
              className="h-8 rounded border border-emerald-300 bg-background px-2 text-xs dark:border-emerald-900"
            />
          </label>
          <p className="text-xs leading-snug text-emerald-900 dark:text-emerald-100/85">
            Counts access indicators at or above the threshold, then scores against the required number of hits.
          </p>
        </div>
      )}

      {methodSettings.aggregation === 'modulePercentileRankedSum' && (
        <div className="grid gap-2 rounded-md border border-cyan-200 bg-cyan-50/70 p-2 dark:border-cyan-900/70 dark:bg-cyan-950/25">
          <div className="font-medium text-cyan-950 dark:text-cyan-100">Module editor</div>
          {metrics.filter((metric) => weights[metric.key] !== 0).map((metric) => (
            <label key={metric.key} className="grid gap-1">
              <span className="text-xs font-medium text-cyan-950 dark:text-cyan-100">{metric.shortLabel}</span>
              <AppSelect
                value={methodSettings.metricModuleOverrides[metric.key] || metric.indexModule || 'localContext'}
                onValueChange={(value) =>
                  updateMethodSettings('metricModuleOverrides', {
                    ...methodSettings.metricModuleOverrides,
                    [metric.key]: value as ScoreIndexModule,
                  })
                }
                options={Object.entries(SCORE_INDEX_MODULE_LABELS).map(([value, label]) => ({ value, label }))}
                triggerClassName="h-8 rounded border-cyan-300 text-xs focus:ring-1 focus:ring-cyan-500 dark:border-cyan-900"
              />
            </label>
          ))}
        </div>
      )}

      <label className="space-y-1">
        <span className="block font-medium text-muted-foreground">Missing data</span>
        <AppSelect
          value={methodSettings.missingData}
          onValueChange={(value) => updateMethodSettings('missingData', value as ScoreMethodSettings['missingData'])}
          options={[
            { value: 'zero', label: 'Treat missing as zero' },
            { value: 'neutral', label: 'Treat missing as neutral' },
          ]}
          triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
        />
      </label>

      <button
        type="button"
        onClick={() => updateMethodSettings('sensitivity', !methodSettings.sensitivity)}
        className={cn(
          'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-colors',
          methodSettings.sensitivity
            ? 'border-cyan-500/60 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/35 dark:text-cyan-100'
            : 'border-input text-muted-foreground hover:text-foreground',
        )}
      >
        <span>
          <span className="block font-semibold">Sensitivity test</span>
          <span className="block text-xs text-muted-foreground">
            Perturb active weights by 15% across 24 trials.
          </span>
        </span>
        <span className="font-bold">{methodSettings.sensitivity ? 'ON' : 'OFF'}</span>
      </button>
    </div>
  )
}
