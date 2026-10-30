import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import { Button } from './button'

export function PaginationControls({
  page,
  pageCount,
  onPageChange,
  label,
  className,
  previousLabel = 'Previous',
  nextLabel = 'Next',
  formatPage = (page, pageCount) => `${page + 1} / ${pageCount}`,
  layout = 'between',
  summaryClassName,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  label: string
  /** Override the default top border and padding, e.g. inside a dialog footer. */
  className?: string
  previousLabel?: string
  nextLabel?: string
  formatPage?: (page: number, pageCount: number) => ReactNode
  /** Keep the default Previous / summary / Next order, or group actions after a leading summary. */
  layout?: 'between' | 'summary-first'
  summaryClassName?: string
}) {
  const previous = (
    <Button variant="outline" className="h-11 md:h-9" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
      {previousLabel}
    </Button>
  )
  const next = (
    <Button
      variant="outline"
      className="h-11 md:h-9"
      disabled={page + 1 >= pageCount}
      onClick={() => onPageChange(page + 1)}
    >
      {nextLabel}
    </Button>
  )
  const summary = (
    <span aria-live="polite" className={cn('text-xs tabular-nums text-muted-foreground', summaryClassName)}>
      {formatPage(page, pageCount)}
    </span>
  )
  return (
    <nav
      aria-label={label}
      className={cn(
        'flex items-center justify-between gap-2 border-t bg-background p-3',
        layout === 'summary-first' && 'flex-wrap',
        className,
      )}
    >
      {layout === 'summary-first' ? (
        <>
          {summary}
          <div className="flex gap-2">
            {previous}
            {next}
          </div>
        </>
      ) : (
        <>
          {previous}
          {summary}
          {next}
        </>
      )}
    </nav>
  )
}
