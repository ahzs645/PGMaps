import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MINIMUM_DATA_COVERAGE } from '../types'
import { DEFAULT_LOCALE } from '@/lib/format'

/**
 * Shown over the map when the data-coverage floor has left little or nothing to rank.
 * Without it the map goes blank or paints one region, which reads as a bug rather than
 * "most of these regions have no data for the metrics you picked".
 */
export function ScoreBuilderCoverageNotice({
  excludedCount,
  rankedCount = 0,
  onShowAnyway,
  onDismiss,
  className,
}: {
  excludedCount: number
  rankedCount?: number
  onShowAnyway: () => void
  onDismiss?: () => void
  className?: string
}) {
  const total = rankedCount + excludedCount
  return (
    <div
      data-score-builder-coverage-notice="true"
      className={cn(
        'pointer-events-auto absolute left-1/2 top-6 z-30 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-amber-300 bg-background/97 p-3 shadow-xl backdrop-blur dark:border-amber-900/70',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            {rankedCount === 0
              ? 'No regions have enough data to rank'
              : `Only ${rankedCount.toLocaleString(DEFAULT_LOCALE)} of ${total.toLocaleString(DEFAULT_LOCALE)} regions ${rankedCount === 1 ? 'has' : 'have'} enough data to rank`}
          </div>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">
            {excludedCount.toLocaleString(DEFAULT_LOCALE)} region{excludedCount === 1 ? '' : 's'} fell below the{' '}
            {Math.round(MINIMUM_DATA_COVERAGE * 100)}% data-coverage floor for the metrics currently weighted. Pick
            metrics that cover this study area, or rank them anyway and read the scores as provisional.
          </p>
          <button
            type="button"
            onClick={onShowAnyway}
            className="mt-2 inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            Rank them anyway
          </button>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss coverage notice"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
