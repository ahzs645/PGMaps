import { Button } from './button'

export function PaginationControls({
  page,
  pageCount,
  onPageChange,
  label,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  label: string
}) {
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-2 border-t bg-background p-3">
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
