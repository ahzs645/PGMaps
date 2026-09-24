import { Badge } from '@/components/ui/badge'
import { InlineAlert } from '@/components/ui/map-panels'
import { EmptyHint } from '@/components/ui/result-list'
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
        <InlineAlert tone="warning" title="Top-rank stability" className="rounded-lg p-3">
          <div className="mt-1">
            Top area held in {(scenarioComparison.stableTopShare * 100).toFixed(0)}% of perturbation trials; average
            rank shift was {scenarioComparison.averageRankShift.toFixed(1)}.
          </div>
        </InlineAlert>
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
              <Badge
                size="sm"
                tone={
                  result.stability === 'stable' ? 'success' : result.stability === 'moderate' ? 'warning' : 'danger'
                }
                className="font-semibold"
              >
                {result.stability}
              </Badge>
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
          <EmptyHint className="p-3">
            Turn on sensitivity testing in the Model tab to generate robustness results.
          </EmptyHint>
        )}
      </div>
    </div>
  )
}
