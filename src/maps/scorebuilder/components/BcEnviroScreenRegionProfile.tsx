import { BC_ENVIRO_SCREEN_METRICS, type BcEnviroScreenComponent } from '../constants'
import { formatMetricValue } from '../lib/metrics'
import type { ScoredBoundaryRegion } from '../types'

interface BcEnviroScreenRegionProfileProps {
  region: ScoredBoundaryRegion
}

const COMPONENTS: Array<{ key: BcEnviroScreenComponent; label: string }> = [
  { key: 'environmentalEffects', label: 'Environmental Effects' },
  { key: 'exposures', label: 'Exposures' },
  { key: 'sensitivePopulations', label: 'Sensitive Populations' },
  { key: 'socioeconomicFactors', label: 'Socioeconomic Factors' },
]

function formatNullable(value: number | null, digits: number, maximum: number): string {
  return value == null ? 'Missing' : `${value.toFixed(digits)}/${maximum}`
}

function percentileColor(percentile: number): string {
  if (percentile <= 0.25) return '#008837'
  if (percentile <= 0.5) return '#a6dba0'
  if (percentile <= 0.75) return '#c2a5cf'
  return '#7b3294'
}

export function BcEnviroScreenRegionProfile({ region }: BcEnviroScreenRegionProfileProps) {
  const profile = region.bcEnviroScreen
  if (!profile) return null

  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900/70 dark:bg-violet-950/20">
      <div className="mb-1 text-sm font-semibold text-foreground">BC EnviroScreen profile</div>
      <div className="text-xs text-muted-foreground">
        Current 89-LHA hybrid reconstruction. Values may differ from the historical Shiny benchmark where source
        vintages or proxies differ.
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <ProfileValue label="Overall Score" value={`${region.score.toFixed(1)}/100`} />
        <ProfileValue
          label="Landscape Burden"
          value={formatNullable(profile.landscapeBurdenScore, 1, 10)}
        />
        <ProfileValue
          label="Population Characteristics"
          value={formatNullable(profile.populationCharacteristicsScore, 1, 10)}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {COMPONENTS.map((component) => {
          const metrics = BC_ENVIRO_SCREEN_METRICS.filter(
            (metric) => metric.bcEnviroScreenComponent === component.key,
          )
          return (
            <div key={component.key} className="rounded-md border border-violet-200 bg-background p-2 dark:border-violet-900/70">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h5 className="text-xs font-semibold text-foreground">{component.label}</h5>
                <span className="text-xs font-semibold text-violet-800 dark:text-violet-200">
                  {formatNullable(profile.components[component.key], 2, 1)}
                </span>
              </div>
              <div className="mb-1 flex justify-between text-[10px] font-medium">
                <span className="text-[#008837]">Better</span>
                <span className="text-[#7b3294]">Worse</span>
              </div>
              <div className="space-y-2">
                {metrics.map((metric) => {
                  const missing = profile.missingIndicators.includes(metric.key)
                  const percentile = missing ? null : region.normalizedMetrics[metric.key]
                  const rawValue = region.metrics[metric.key]
                  const bounded = percentile == null ? null : Math.min(1, Math.max(0, percentile))
                  return (
                    <div key={metric.key}>
                      <div className="mb-0.5 flex items-start justify-between gap-2 text-[10px] leading-tight">
                        <span className="min-w-0 text-foreground">{metric.shortLabel}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {missing ? 'Missing' : formatMetricValue(metric.key, rawValue, true)}
                        </span>
                      </div>
                      <div
                        className="relative h-3"
                        role="img"
                        aria-label={
                          bounded == null
                            ? `${metric.label}: missing`
                            : `${metric.label}: ${(bounded * 100).toFixed(1)}th provincial percentile; raw value ${formatMetricValue(metric.key, rawValue, true)}`
                        }
                      >
                        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border" />
                        <div className="absolute bottom-0 left-1/2 top-0 w-px bg-slate-300 dark:bg-slate-700" />
                        {bounded != null && (
                          <>
                            <div
                              className="absolute top-1/2 h-px -translate-y-1/2 bg-slate-700 dark:bg-slate-300"
                              style={{
                                left: `${Math.min(50, bounded * 100)}%`,
                                width: `${Math.abs(bounded * 100 - 50)}%`,
                              }}
                            />
                            <span
                              className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/30"
                              style={{ left: `${bounded * 100}%`, backgroundColor: percentileColor(bounded) }}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-3 rounded border border-violet-200 bg-background px-2 py-1.5 font-mono text-xs dark:border-violet-900/70">
        <div className="mb-0.5 font-sans font-semibold text-foreground">
          {profile.formulaMode === 'custom' ? 'Advanced formula' : 'Reconstruction formula'}
        </div>
        <div className="break-words text-muted-foreground">{profile.formulaExpression}</div>
        {profile.formulaError && (
          <div className="mt-1 font-sans font-medium text-rose-700 dark:text-rose-300">{profile.formulaError}</div>
        )}
      </div>
    </section>
  )
}

function ProfileValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-violet-200 bg-background px-2 py-1.5 dark:border-violet-900/70">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold text-foreground">{value}</div>
    </div>
  )
}
