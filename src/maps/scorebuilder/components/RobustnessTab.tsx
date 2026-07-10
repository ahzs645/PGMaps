import { cn } from '@/lib/utils'
import type { RobustnessResult, ScenarioComparison } from '../types'
import { formatScore, getMetricLabel } from '../lib/metrics'

interface RobustnessTabProps {
  className?: string
  robustnessResults: RobustnessResult[]
  scenarioComparison: ScenarioComparison | null
}

export function RobustnessTab({ className = 'p-4', robustnessResults, scenarioComparison }: RobustnessTabProps) {
  return (
    <div className={cn('space-y-3', className)} data-score-builder-section="robustness">
      <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
        <div className="mb-1 text-sm font-semibold text-foreground">Rank confidence</div>
        <p>
          Runs deterministic stress checks against the active recipe: 15% weight perturbations, leave-one-indicator-out
          tests, and alternate normalization methods.
        </p>
      </div>

      {scenarioComparison && (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
          <div className="font-semibold">Top-rank stability</div>
          <div className="mt-1">
            Top area held in {(scenarioComparison.stableTopShare * 100).toFixed(0)}% of perturbation trials; average
            rank shift was {scenarioComparison.averageRankShift.toFixed(1)}.
          </div>
        </div>
      )}

      <div className="space-y-2">
        {robustnessResults.map((result) => (
          <div key={result.regionId} className="rounded-lg border border-border bg-background p-3 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-foreground">
                  #{result.baseRank} {result.regionName}
                </div>
                <div className="text-xs text-muted-foreground">
                  median rank {result.medianRank.toFixed(1)} · interval #{result.rankInterval[0]}-#
                  {result.rankInterval[1]}
                </div>
              </div>
              <span
                className={cn(
                  'rounded px-2 py-0.5 text-xs font-semibold',
                  result.stability === 'stable'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : result.stability === 'moderate'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
                )}
              >
                {result.stability}
              </span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Score interval {formatScore(result.scoreInterval[0])}-{formatScore(result.scoreInterval[1])}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Drivers: {result.topDrivers.map(getMetricLabel).join(', ')}
            </div>
          </div>
        ))}
        {robustnessResults.length === 0 && (
          <div className="rounded border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            Turn on sensitivity testing in the Model tab to generate robustness results.
          </div>
        )}
      </div>
    </div>
  )
}
