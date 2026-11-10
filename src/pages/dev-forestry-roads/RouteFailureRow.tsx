import { forwardRef } from 'react'
import { Button } from '@/components/ui/button'
import type { RouteRow } from './routeComparison'
import type { RouteSearchStop } from './routeSearchStop'
import { steeperGradeText, steeperGrades, type SteeperGradeResult } from './steeperGrades'

const whole = (n: number) => Math.round(n).toLocaleString('en-CA')

/**
 * Goals that found no road for one reason. Clicking the row marks on the plan where the search
 * stopped (and the place the reason names); clicking that mark selects the row. **Try steeper**
 * runs the search a little over the limit and reports what it finds, without making a road.
 */
export const RouteFailureRow = forwardRef<
  HTMLButtonElement,
  {
    goals: RouteRow[]
    message: string
    stop?: RouteSearchStop
    steeper?: SteeperGradeResult
    limitPercent: number
    selected: boolean
    busy: boolean
    onToggle: () => void
    onHover: (on: boolean) => void
    onTrySteeper: () => void
  }
>(function RouteFailureRow(
  { goals, message, stop, steeper, limitPercent, selected, busy, onToggle, onHover, onTrySteeper },
  ref,
) {
  const grades = steeperGrades(limitPercent)
  const text = (
    <>
      {/* Phrasing content: this sits inside a button. Not a span.font-medium, which names a found road. */}
      <strong className="block font-medium">{goals.map((row) => row.label).join(' · ')}</strong>
      <span className="block text-2xs leading-4 text-muted-foreground">{message}</span>
    </>
  )
  return (
    <div
      className={`rounded-md border border-dashed px-2 py-1.5 text-xs ${selected ? 'border-red-600 bg-red-50/60 dark:bg-red-950/30' : ''}`}
      data-route-row={goals[0].goal}
    >
      {stop ? (
        <button
          ref={ref}
          type="button"
          className="block w-full text-left"
          aria-pressed={selected}
          onClick={onToggle}
          onMouseEnter={() => onHover(true)}
          onMouseLeave={() => onHover(false)}
          onFocus={() => onHover(true)}
          onBlur={() => onHover(false)}
          data-testid="road-route-failure"
        >
          {text}
          <span className="block text-2xs leading-4 text-red-700 dark:text-red-400" data-testid="road-route-stop">
            {selected ? 'Marked on the plan' : 'Show on the plan'}: where it stopped
            {stop.remainingM >= 1 ? `, ${whole(stop.remainingM)} m short of the end` : ''}
            {stop.named ? `; ${stop.named.label.toLowerCase()}` : ''}.
          </span>
        </button>
      ) : (
        <div data-testid="road-route-failure">{text}</div>
      )}
      {steeper ? (
        <p className="mt-1 text-2xs leading-4" data-testid="road-route-steeper">
          {steeperGradeText(steeper)}
        </p>
      ) : (
        stop &&
        grades.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="mt-1 h-7 px-2 text-xs"
            disabled={busy}
            onClick={onTrySteeper}
            data-testid="road-route-try-steeper"
            title="Searches again over the grade limit and says whether the ends connect. No road is added and the limit is not changed."
          >
            Try {grades.map((grade) => `${grade}%`).join(' and ')}
          </Button>
        )
      )}
    </div>
  )
})
