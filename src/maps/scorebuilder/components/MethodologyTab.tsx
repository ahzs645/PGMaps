import { BookOpen } from 'lucide-react'
import { SCORE_INDEX_MODULE_LABELS, SCORE_METRICS, SCORE_PRESETS, getScorePresetMethodology } from '../constants'
import type { ScoreComponentSummary, ScoreMetricWeightMap, ScoreMethodSettings } from '../types'
import { formatScore } from '../lib/metrics'
import { formatAggregationMethod, formatNormalizationMethod } from './scoreBuilderPanelUtils'

interface MethodologyTabProps {
  className?: string
  weights: ScoreMetricWeightMap
  methodSettings: ScoreMethodSettings
  componentSummaries: ScoreComponentSummary[]
  activePreset: (typeof SCORE_PRESETS)[number] | null
}

export function MethodologyTab({
  className = 'p-4',
  weights,
  methodSettings,
  componentSummaries,
  activePreset,
}: MethodologyTabProps) {
  const activeMetrics = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)
  const presetMethodology = activePreset ? getScorePresetMethodology(activePreset) : null

  return (
    <div className={`space-y-3 ${className}`} data-score-builder-section="methodology">
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-cyan-600" />
          <div className="text-sm font-semibold text-foreground">COINr-lite method</div>
        </div>
        <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            PGMaps builds a transparent composite indicator from normalized boundary metrics, signed user weights, and
            the selected aggregation method.
          </p>
          <p>
            Current settings: {formatNormalizationMethod(methodSettings.normalization)} normalization,{' '}
            {formatAggregationMethod(methodSettings.aggregation)} aggregation, missing data set to{' '}
            {methodSettings.missingData}.
          </p>
          <p>
            Scores are relative to the currently loaded boundary level; filters do not redefine percentiles. Use for
            planning triage, not validated exposure, health, or funding eligibility determination.
          </p>
        </div>
      </div>

      {presetMethodology && (
        <div className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 text-sm font-semibold text-foreground">Preset methodology notes</div>
          <div className="space-y-2 text-xs text-muted-foreground">
            <div>
              <span className="font-semibold text-foreground">Purpose:</span> {presetMethodology.purpose}
            </div>
            <div>
              <span className="font-semibold text-foreground">Included components:</span>{' '}
              {presetMethodology.components.join(', ') || 'Custom metric set'}
            </div>
            <div>
              <span className="font-semibold text-foreground">Preset normalization:</span>{' '}
              {presetMethodology.normalization}
            </div>
            {presetMethodology.proxy && (
              <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
                Proxy recipe. Use it for screening and conversation, not as a validated health, exposure, or EJ index.
              </div>
            )}
            <div>
              <div className="font-semibold text-foreground">Known limits</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {presetMethodology.knownLimits.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-semibold text-foreground">Data still needed</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {presetMethodology.dataNeeded.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {componentSummaries.length > 0 && (
        <div className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 text-sm font-semibold text-foreground">Component sub-scores</div>
          <div className="space-y-2">
            {componentSummaries.map((component) => (
              <div key={component.key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">{component.label}</span>
                  <span className="text-muted-foreground">
                    {formatScore(component.score)} · {(component.weightShare * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-cyan-500" style={{ width: `${component.score}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 text-sm font-semibold text-foreground">Active indicator metadata</div>
        <div className="space-y-2">
          {activeMetrics.map((metric) => (
            <div key={metric.key} className="rounded border border-border bg-muted/15 p-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-foreground">{metric.label}</div>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {metric.uncertainty} uncertainty
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {metric.directionLabel} · weight {weights[metric.key]} · {metric.dataSourceLabel} ·{' '}
                {metric.spatialMethod}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {metric.freshnessLabel} · {metric.comparisonBasis}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Module{' '}
                {
                  SCORE_INDEX_MODULE_LABELS[
                    methodSettings.metricModuleOverrides[metric.key] || metric.indexModule || 'localContext'
                  ]
                }{' '}
                · domain {metric.indexDomain || 'local context'} · {metric.proxyLevel || 'proxy'} metric
              </div>
              {metric.caveat && (
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{metric.caveat}</div>
              )}
            </div>
          ))}
          {activeMetrics.length === 0 && (
            <div className="rounded border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              Add metrics or apply a preset to see indicator metadata.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
