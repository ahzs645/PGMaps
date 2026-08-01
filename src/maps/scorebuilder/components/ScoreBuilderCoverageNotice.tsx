import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MINIMUM_DATA_COVERAGE } from '../types'

/**
 * Shown over the map when the data-coverage floor has left nothing to rank. Without
 * it the map just goes blank, which reads as a loading bug rather than "none of
 * these regions have enough data for the metrics you picked".
 */
export function ScoreBuilderCoverageNotice({
  excludedCount,
  onShowAnyway,
  className,
}: {
  excludedCount: number
  onShowAnyway: () => void
  className?: string
}) {
  return (
    <div
      data-score-builder-coverage-notice="true"
      className={cn(
        'pointer-events-auto absolute left-1/2 top-6 z-20 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-amber-300 bg-background/97 p-3 shadow-xl backdrop-blur dark:border-amber-900/70',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">No regions have enough data to rank</div>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">
            {excludedCount.toLocaleString()} region{excludedCount === 1 ? '' : 's'} fell below the{' '}
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
      </div>
    </div>
  )
}
