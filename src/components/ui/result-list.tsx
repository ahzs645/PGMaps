import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InlineAlert } from './map-panels'
import { TextButton } from './text-button'

export type ResultRowAccent = 'sky' | 'green' | 'cyan' | 'amber' | 'violet' | 'orange' | 'rose' | 'teal'

// Selected rows get a tint plus a left bar, so selection does not rely on colour alone.
const selectedClasses: Record<ResultRowAccent, string> = {
  sky: 'bg-sky-50 shadow-[inset_3px_0_0_theme(colors.sky.500)] dark:bg-sky-950/30',
  green: 'bg-green-50 shadow-[inset_3px_0_0_theme(colors.green.500)] dark:bg-green-950/30',
  cyan: 'bg-cyan-50 shadow-[inset_3px_0_0_theme(colors.cyan.500)] dark:bg-cyan-950/30',
  amber: 'bg-amber-50 shadow-[inset_3px_0_0_theme(colors.amber.500)] dark:bg-amber-950/30',
  violet: 'bg-violet-50 shadow-[inset_3px_0_0_theme(colors.violet.500)] dark:bg-violet-950/30',
  orange: 'bg-orange-50 shadow-[inset_3px_0_0_theme(colors.orange.500)] dark:bg-orange-950/30',
  rose: 'bg-rose-50 shadow-[inset_3px_0_0_theme(colors.rose.500)] dark:bg-rose-950/30',
  teal: 'bg-teal-50 shadow-[inset_3px_0_0_theme(colors.teal.500)] dark:bg-teal-950/30',
}

const focusClasses: Record<ResultRowAccent, string> = {
  sky: 'focus-visible:ring-sky-500',
  green: 'focus-visible:ring-green-500',
  cyan: 'focus-visible:ring-cyan-500',
  amber: 'focus-visible:ring-amber-500',
  violet: 'focus-visible:ring-violet-500',
  orange: 'focus-visible:ring-orange-500',
  rose: 'focus-visible:ring-rose-500',
  teal: 'focus-visible:ring-teal-500',
}

type ResultRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
  title: ReactNode
  subtitle?: ReactNode
  /** Extra lines under the subtitle: badges, counts, a type label. */
  meta?: ReactNode
  /** Left marker: pass `dotColor` for a plain dot, or any node. */
  leading?: ReactNode
  dotColor?: string
  /** Right-hand value, e.g. a reading or a score. */
  trailing?: ReactNode
  selected?: boolean
  accent?: ResultRowAccent
}

/**
 * One row of a sidebar result list: marker, title, subtitle, meta, and an
 * optional value on the right. A button with aria-pressed so keyboard and
 * screen-reader users can tell which row is selected.
 */
export function ResultRow({
  title,
  subtitle,
  meta,
  leading,
  dotColor,
  trailing,
  selected = false,
  accent = 'sky',
  className,
  type = 'button',
  ...props
}: ResultRowProps) {
  const marker =
    leading ??
    (dotColor ? <span className="mt-1 inline-block h-3 w-3 rounded-full" style={{ backgroundColor: dotColor }} /> : null)

  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-2 px-3 py-3 text-left transition-colors hover:bg-slate-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset dark:hover:bg-slate-800/60',
        focusClasses[accent],
        selected && selectedClasses[accent],
        className,
      )}
      {...props}
    >
      {marker && <span className="shrink-0">{marker}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
        {meta && <span className="mt-1 block text-xs text-muted-foreground">{meta}</span>}
      </span>
      {trailing && <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">{trailing}</span>}
    </button>
  )
}

type ListHeaderProps = {
  count: number
  /** Noun for the items, e.g. `['station', 'stations']`. */
  noun: readonly [string, string]
  /** How many rows are rendered when the list is capped; shows "showing first N". */
  shown?: number
  /** Anything else for the right side (a hint, a sort control). */
  aside?: ReactNode
  sticky?: boolean
  className?: string
}

/** "N items" line above a result list, sticky by default so it stays as the list scrolls. */
export function ListHeader({ count, noun, shown, aside, sticky = true, className }: ListHeaderProps) {
  const capped = shown != null && shown < count
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-b border-border bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur',
        sticky && 'sticky top-0 z-10',
        className,
      )}
      aria-live="polite"
    >
      <span>
        {count.toLocaleString('en-CA')} {count === 1 ? noun[0] : noun[1]}
        {capped && ` · showing first ${shown.toLocaleString('en-CA')}`}
      </span>
      {aside}
    </div>
  )
}

type ListStateProps = {
  loading?: boolean
  loadingLabel?: string
  error?: string | null
  errorTitle?: string
  empty?: boolean
  emptyLabel?: ReactNode
  /** Offer a way out of an empty result, e.g. reset filters. */
  onReset?: () => void
  resetLabel?: string
  children?: ReactNode
  className?: string
}

/**
 * Loading, error and empty handling for a result list, the same everywhere.
 * Renders `children` (the list) unless loading or failed.
 */
export function ListState({
  loading = false,
  loadingLabel = 'Loading...',
  error,
  errorTitle = 'Could not load data',
  empty = false,
  emptyLabel = 'Nothing matches these filters.',
  onReset,
  resetLabel = 'Reset filters',
  children,
  className,
}: ListStateProps) {
  if (loading) {
    return (
      <div className={cn('flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground', className)} role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {loadingLabel}
      </div>
    )
  }
  if (error) {
    return (
      <div className={cn('p-3', className)}>
        <InlineAlert tone="error" title={errorTitle}>
          {error}
        </InlineAlert>
      </div>
    )
  }
  return (
    <>
      {empty && (
        <div className={cn('space-y-2 p-4 text-sm text-muted-foreground', className)}>
          <p>{emptyLabel}</p>
          {onReset && <TextButton onClick={onReset}>{resetLabel}</TextButton>}
        </div>
      )}
      {children}
    </>
  )
}

/** A small "nothing here yet" note inside a panel or tab (not a whole dialog body). */
export function EmptyHint({
  children,
  variant = 'dashed',
  className,
}: {
  children: ReactNode
  variant?: 'dashed' | 'plain'
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-lg p-4 text-center text-xs text-muted-foreground',
        variant === 'dashed' && 'border border-dashed border-border',
        className,
      )}
    >
      {children}
    </div>
  )
}
