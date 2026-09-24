import { ArrowDown, ArrowUp, Pin, X } from 'lucide-react'
import { StatGroup } from '@/components/ui/stat-group'
import { DEFAULT_LOCALE } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { BaselineComparisonResult, BaselineSnapshot } from '../lib/baselineComparison'
import { formatScore } from '../lib/metrics'

const BASELINE_TILE_CLASS = 'border-violet-200/70 bg-white/60 p-1.5 dark:border-violet-900/60 dark:bg-violet-950/40'

interface BaselineComparisonCardProps {
  baseline: BaselineSnapshot | null
  comparison: BaselineComparisonResult | null
  onPinBaseline: () => void
  onClearBaseline: () => void
}

/**
 * What-if scenario card: pin the current ranking as scenario A, keep editing
 * the index, and watch how regions move relative to that frozen baseline.
 */
export function BaselineComparisonCard({
  baseline,
  comparison,
  onPinBaseline,
  onClearBaseline,
}: BaselineComparisonCardProps) {
  if (!baseline || !comparison) {
    return (
      <div
        className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/10 p-3"
        data-score-builder-baseline="empty"
      >
        <div className="min-w-0 text-xs text-muted-foreground">
          Pin the current ranking, then change weights to see which regions move.
        </div>
        <button
          type="button"
          onClick={onPinBaseline}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Pin className="h-3.5 w-3.5" />
          Pin baseline
        </button>
      </div>
    )
  }

  return (
    <div
      className="rounded-lg border border-violet-300/60 bg-violet-50/60 p-3 dark:border-violet-900/60 dark:bg-violet-950/20"
      data-score-builder-baseline="active"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-violet-900 dark:text-violet-100">
            Vs baseline: {baseline.label}
          </div>
          <div className="text-xs text-violet-800/80 dark:text-violet-200/80">
            Pinned {new Date(baseline.capturedAt).toLocaleTimeString(DEFAULT_LOCALE)} · {comparison.sharedRegionCount}{' '}
            shared regions
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onPinBaseline}
            title="Re-pin baseline to the current ranking"
            className="rounded-md border border-violet-300/70 px-2 py-1 text-xs font-medium text-violet-800 transition-colors hover:bg-violet-100/60 dark:border-violet-800 dark:text-violet-200"
          >
            Re-pin
          </button>
          <button
            type="button"
            onClick={onClearBaseline}
            title="Clear baseline"
            aria-label="Clear baseline"
            className="rounded-md border border-violet-300/70 p-1 text-violet-800 transition-colors hover:bg-violet-100/60 dark:border-violet-800 dark:text-violet-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <StatGroup
        variant="tiles"
        size="sm"
        columns={3}
        className="mt-2"
        items={[
          { label: 'avg rank shift', value: comparison.averageAbsRankShift.toFixed(1) },
          {
            label: 'avg score Δ',
            value: `${comparison.averageScoreDelta >= 0 ? '+' : ''}${formatScore(comparison.averageScoreDelta)}`,
          },
          { label: 'top region', value: comparison.topChanged ? 'Changed' : 'Held' },
        ].map((item) => ({
          ...item,
          className: BASELINE_TILE_CLASS,
          valueClassName: 'text-violet-900 dark:text-violet-100',
        }))}
      />

      {comparison.topChanged && (
        <div className="mt-2 text-xs text-violet-900 dark:text-violet-100">
          Top region: {baseline.topRegionName || 'None'} → {comparison.currentTopName || 'None'}
        </div>
      )}

      {comparison.topMovers.length > 0 ? (
        <div className="mt-2 space-y-1">
          {comparison.topMovers.map((mover) => (
            <div key={mover.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-violet-900 dark:text-violet-100">{mover.name}</span>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-0.5 font-medium',
                  mover.rankDelta > 0
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : mover.rankDelta < 0
                      ? 'text-rose-700 dark:text-rose-300'
                      : 'text-violet-700 dark:text-violet-300',
                )}
              >
                {mover.rankDelta > 0 ? (
                  <ArrowUp className="h-3 w-3" />
                ) : mover.rankDelta < 0 ? (
                  <ArrowDown className="h-3 w-3" />
                ) : null}
                #{mover.baselineRank} → #{mover.currentRank}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-xs text-violet-800/80 dark:text-violet-200/80">
          No rank movement vs the baseline yet — adjust weights, methods, or filters to compare scenarios.
        </div>
      )}

      {(comparison.newRegionCount > 0 || comparison.droppedRegionCount > 0) && (
        <div className="mt-2 text-xs text-violet-800/80 dark:text-violet-200/80">
          {comparison.newRegionCount} regions entered and {comparison.droppedRegionCount} left the comparison (boundary
          or filter changes).
        </div>
      )}
    </div>
  )
}
