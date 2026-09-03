import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BC_ENVIRO_SCREEN_METRICS, bcEnviroScreenIndicatorKey, type BcEnviroScreenComponent } from '../constants'
import type { ScoreMetricDefinition, ScoreMetricWeightMap, ScoreMethodSettings } from '../types'
import {
  BC_ENVIRO_SCREEN_DEFAULT_FORMULA,
  BC_ENVIRO_SCREEN_FORMULA_VARIABLES,
  validateBcEnviroScreenFormula,
} from '../lib/bcEnviroScreenFormula'

const COMPONENTS: Array<{
  key: BcEnviroScreenComponent
  label: string
  variable: string
  tone: string
}> = [
  {
    key: 'exposures',
    label: 'Environmental exposures',
    variable: 'exposures',
    tone: 'border-orange-200 bg-orange-50/60 dark:border-orange-900/60 dark:bg-orange-950/20',
  },
  {
    key: 'environmentalEffects',
    label: 'Environmental effects',
    variable: 'environmental_effects',
    tone: 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20',
  },
  {
    key: 'sensitivePopulations',
    label: 'Sensitive populations',
    variable: 'sensitive_populations',
    tone: 'border-fuchsia-200 bg-fuchsia-50/60 dark:border-fuchsia-900/60 dark:bg-fuchsia-950/20',
  },
  {
    key: 'socioeconomicFactors',
    label: 'Socioeconomic factors',
    variable: 'socioeconomic_factors',
    tone: 'border-violet-200 bg-violet-50/60 dark:border-violet-900/60 dark:bg-violet-950/20',
  },
]

export function BcEnviroScreenEquationEditor({
  weights,
  metrics,
  methodSettings,
  onMethodSettingsChange,
}: {
  weights: ScoreMetricWeightMap
  metrics: ScoreMetricDefinition[]
  methodSettings: ScoreMethodSettings
  onMethodSettingsChange: (settings: ScoreMethodSettings) => void
}) {
  const indicatorKeys = BC_ENVIRO_SCREEN_METRICS.map((metric) => bcEnviroScreenIndicatorKey(metric.key)).filter(
    (key): key is string => Boolean(key),
  )
  const formula = methodSettings.bcEnviroScreenFormula
  const formulaError =
    formula.mode === 'custom' ? validateBcEnviroScreenFormula(formula.expression, indicatorKeys) : null

  const setFormula = (next: ScoreMethodSettings['bcEnviroScreenFormula']) =>
    onMethodSettingsChange({ ...methodSettings, bcEnviroScreenFormula: next })

  const setComponentWeight = (key: BcEnviroScreenComponent, value: number) =>
    onMethodSettingsChange({
      ...methodSettings,
      bcEnviroScreenComponentWeights: {
        ...methodSettings.bcEnviroScreenComponentWeights,
        [key]: Math.max(0, Math.min(10, value)),
      },
    })

  return (
    <div className="grid gap-3 rounded-md border border-violet-200 bg-violet-50/40 p-2 dark:border-violet-900/70 dark:bg-violet-950/20">
      <div>
        <div className="font-semibold text-violet-950 dark:text-violet-100">BC EnviroScreen equation</div>
        <p className="mt-0.5 leading-snug text-violet-900/80 dark:text-violet-100/75">
          Indicator variables are provincial percentiles from 0–1. The two max-scaled composite variables run from 0–10;
          the displayed map score is clamped to 0–100.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-md border border-violet-200 bg-background/80 p-1 dark:border-violet-900">
        {(
          [
            ['reconstruction', 'Reconstruction'],
            ['custom', 'Advanced formula'],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => setFormula({ ...formula, mode })}
            className={cn(
              'rounded px-2 py-1.5 text-xs font-semibold transition-colors',
              formula.mode === mode
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-muted-foreground hover:bg-violet-100 hover:text-foreground dark:hover:bg-violet-950',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {COMPONENTS.map((component) => {
          const componentMetrics = metrics.filter(
            (metric) => metric.bcEnviroScreenComponent === component.key && (weights[metric.key] ?? 0) > 0,
          )
          return (
            <section key={component.key} className={cn('rounded-md border p-2', component.tone)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-foreground">{component.label}</div>
                  <code className="text-xs text-muted-foreground">{component.variable}</code>
                </div>
                <label className="w-20 shrink-0">
                  <span className="sr-only">{component.label} weight</span>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.25}
                    value={methodSettings.bcEnviroScreenComponentWeights[component.key]}
                    onChange={(event) => setComponentWeight(component.key, Number(event.target.value))}
                    className="h-8 w-full rounded border border-input bg-background px-2 text-xs"
                    title={`${component.label} component weight`}
                  />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {componentMetrics.map((metric) => (
                  <span
                    key={metric.key}
                    className="rounded border border-border/70 bg-background/75 px-1.5 py-0.5 text-xs text-muted-foreground"
                    title={bcEnviroScreenIndicatorKey(metric.key) ?? metric.key}
                  >
                    {weights[metric.key]}× {metric.shortLabel}
                  </span>
                ))}
                {!componentMetrics.length && <span className="text-xs text-amber-700">No active indicators</span>}
              </div>
            </section>
          )
        })}
      </div>

      <div className="rounded-md border border-violet-200 bg-background p-2 font-mono text-xs leading-5 dark:border-violet-900">
        <div>landscape_burden = max-scale(weighted mean(exposures, environmental_effects), 0–10)</div>
        <div>
          population_characteristics = max-scale(weighted mean(sensitive_populations, socioeconomic_factors), 0–10)
        </div>
        <div className="mt-1 font-semibold text-violet-800 dark:text-violet-200">
          score = {formula.mode === 'custom' ? formula.expression || '…' : BC_ENVIRO_SCREEN_DEFAULT_FORMULA}
        </div>
      </div>

      {formula.mode === 'custom' && (
        <div className="space-y-2 rounded-md border border-violet-300 bg-background p-2 dark:border-violet-800">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="bc-enviro-screen-formula" className="font-semibold text-foreground">
              Advanced formula
            </label>
            <button
              type="button"
              onClick={() => setFormula({ mode: 'custom', expression: BC_ENVIRO_SCREEN_DEFAULT_FORMULA })}
              className="inline-flex items-center gap-1 rounded border border-input px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
          <textarea
            id="bc-enviro-screen-formula"
            value={formula.expression}
            onChange={(event) => setFormula({ mode: 'custom', expression: event.target.value })}
            rows={3}
            spellCheck={false}
            className={cn(
              'w-full resize-y rounded-md border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:ring-1',
              formulaError
                ? 'border-rose-400 focus:ring-rose-500'
                : 'border-violet-300 focus:ring-violet-500 dark:border-violet-800',
            )}
          />
          {formulaError ? (
            <p className="text-xs font-medium text-rose-700 dark:text-rose-300">{formulaError}</p>
          ) : (
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Valid formula · live results updated
            </p>
          )}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Variables and functions</summary>
            <p className="mt-1">
              Components: {BC_ENVIRO_SCREEN_FORMULA_VARIABLES.join(', ')}. Indicator percentile variables:{' '}
              {indicatorKeys.join(', ')}.
            </p>
            <p className="mt-1">
              Operators: + − * / ^ and parentheses. Functions: mean(), min(), max(), abs(), clamp().
            </p>
          </details>
        </div>
      )}

      <p className="leading-snug text-violet-900 dark:text-violet-100/85">
        Provincial one-based percentile ranks are fixed before filtering. Zero values rank as zero; missing values are
        excluded from component means. Formulas are parsed by a restricted evaluator and never executed as JavaScript.
      </p>
    </div>
  )
}
