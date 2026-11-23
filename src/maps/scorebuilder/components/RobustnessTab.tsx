import { CalculationTable } from '@/components/ui/calculation-results'
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
        {robustnessResults.length > 0 && (
          <CalculationTable
            caption="Rank and score sensitivity across the tested scenarios"
            rows={robustnessResults}
            rowKey={(r) => r.regionId}
            columns={[
              { label: 'Area and baseline rank', render: (r) => `#${r.baseRank} ${r.regionName}` },
              { label: 'Median rank', render: (r) => r.medianRank.toFixed(1) },
              { label: 'Rank interval', render: (r) => `#${r.rankInterval[0]}–#${r.rankInterval[1]}` },
              {
                label: 'Score interval',
                render: (r) => `${formatScore(r.scoreInterval[0])}–${formatScore(r.scoreInterval[1])}`,
              },
              {
                label: 'Stability',
                render: (r) => (
                  <Badge
                    size="sm"
                    tone={r.stability === 'stable' ? 'success' : r.stability === 'moderate' ? 'warning' : 'danger'}
                    className="font-semibold"
                  >
                    {r.stability}
                  </Badge>
                ),
              },
              { label: 'Drivers', render: (r) => r.topDrivers.map(getMetricLabel).join(', ') },
            ]}
          />
        )}
        {robustnessResults.length === 0 && (
          <EmptyHint className="p-3">
            Turn on sensitivity testing in the Model tab to generate robustness results.
          </EmptyHint>
        )}
      </div>
    </div>
  )
}
