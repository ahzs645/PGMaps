import { ArrowDown, ArrowUp } from 'lucide-react'
import { ResultRow } from '@/components/ui/result-list'
import type { RatingChange } from '../inspectionTimeline'

interface RatingChangeListProps {
  /** Month the changes fall in, e.g. "Mar 2024". */
  monthLabel: string
  changes: RatingChange[]
  onSelect: (change: RatingChange) => void
}

/**
 * The restaurants whose hazard rating moved in the timeline's month. The list
 * stops partway through a row, which is what says it scrolls.
 */
export function RatingChangeList({ monthLabel, changes, onSelect }: RatingChangeListProps) {
  return (
    <section aria-label={`Rating changes in ${monthLabel}`} className="border-b border-border bg-background/95">
      <h3 className="px-4 pt-2 text-xs font-medium text-foreground">Rating changes in {monthLabel}</h3>
      {changes.length === 0 ? (
        <p className="px-4 pb-2 pt-1 text-xs text-muted-foreground">No rating changed this month.</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto pb-1">
          {changes.map((change) => {
            const Arrow = change.direction === 'worse' ? ArrowUp : ArrowDown
            return (
              <li key={`${change.restaurant.details_url}-${change.date.getTime()}-${change.from}-${change.to}`}>
                <ResultRow
                  onClick={() => onSelect(change)}
                  leading={
                    <Arrow
                      aria-hidden="true"
                      className={
                        change.direction === 'worse'
                          ? 'mt-0.5 size-3.5 text-red-600 dark:text-red-400'
                          : 'mt-0.5 size-3.5 text-green-600 dark:text-green-400'
                      }
                    />
                  }
                  title={change.restaurant.name}
                  subtitle={`${change.from} to ${change.to} · ${change.date.toLocaleDateString('en-CA', {
                    month: 'short',
                    day: 'numeric',
                  })}`}
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
