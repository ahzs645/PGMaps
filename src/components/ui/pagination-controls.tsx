import { cn } from '@/lib/utils'
import { Button } from './button'

export function PaginationControls({
  page,
  pageCount,
  onPageChange,
  label,
  className,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  label: string
  /** Override the default top border and padding, e.g. inside a dialog footer. */
  className?: string
}) {
  return (
    <nav aria-label={label} className={cn('flex items-center justify-between gap-2 border-t bg-background p-3', className)}>
      <Button variant="outline" className="h-11 md:h-9" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
        Previous
      </Button>
      <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
        {page + 1} / {pageCount}
      </span>
      <Button
        variant="outline"
        className="h-11 md:h-9"
        disabled={page + 1 >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  )
}
