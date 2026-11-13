import { useId, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, OctagonAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

/** A row's look: a broken limit, an input still to do, a met check, or one that could not be made. */
export type CheckTone = 'limit' | 'todo' | 'met' | 'not-assessed'

const EXPANDED = {
  limit: 'bg-danger-surface text-danger-foreground',
  todo: 'bg-warning-surface text-warning-foreground',
  met: 'bg-success-surface text-success-foreground',
  'not-assessed': 'bg-muted text-muted-foreground',
}

function ToneIcon({ tone }: { tone: CheckTone }) {
  if (tone === 'met')
    return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" role="img" aria-label="Met" />
  if (tone === 'not-assessed')
    return (
      <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" role="img" aria-label="Not assessed" />
    )
  return tone === 'limit' ? (
    <OctagonAlert
      className="mt-0.5 size-3.5 shrink-0 text-danger"
      role="img"
      aria-label="Needs attention: outside a limit"
    />
  ) : (
    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" role="img" aria-label="Needs attention: to do" />
  )
}

/**
 * One Review row: an icon for its state, what was found as its title, a measured line with the way
 * to fix it beside it, and more under it when opened. The readiness checks and the incomplete-section
 * fixes both draw through this, so the Review list reads as one list.
 */
export function CheckCard({
  tone,
  result,
  measured,
  action,
  details,
  title,
  label,
  defaultOpen = false,
  className,
  ...data
}: {
  tone: CheckTone
  /** What was found, the row's title line. */
  result: ReactNode
  /** The measured value: two lines while folded, all of it opened. */
  measured: ReactNode
  /** The button that goes to the fix, beside the measured line. */
  action?: ReactNode
  /** Shown only while the row is open. */
  details?: ReactNode
  /** The check's name, as the row's tooltip. */
  title?: string
  /** The row button's accessible name. */
  label: string
  defaultOpen?: boolean
  className?: string
} & { [key: `data-${string}`]: string | undefined }) {
  const [open, setOpen] = useState(defaultOpen)
  const detail = useId()
  return (
    <li
      className={cn(
        'overflow-hidden rounded-lg border bg-card text-xs text-card-foreground',
        tone === 'limit' && 'border-danger-border',
        tone === 'todo' && 'border-warning-border',
        className,
      )}
      {...data}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detail}
        title={title}
        aria-label={label}
        className={cn(
          'flex w-full items-start gap-2 px-2 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
          open ? EXPANDED[tone] : 'hover:bg-muted hover:text-muted-foreground',
        )}
        onClick={() => setOpen(!open)}
      >
        <ToneIcon tone={tone} />
        <span className="min-w-0 flex-1 font-medium leading-4">{result}</span>
        <ChevronDown
          aria-hidden
          className={cn('mt-0.5 size-3 shrink-0 transition-transform', open ? 'rotate-180' : 'text-muted-foreground')}
        />
      </button>
      <div id={detail} className="space-y-1 pb-2 pl-[1.625rem] pr-2 text-2xs leading-4">
        {/* The measured value and the way to fix it share a line, so a row is two or three lines tall. */}
        <div className="flex items-start gap-2">
          <div className={cn('min-w-0 flex-1 break-words', !open && 'line-clamp-2')}>{measured}</div>
          {action}
        </div>
        {open && details}
      </div>
    </li>
  )
}
