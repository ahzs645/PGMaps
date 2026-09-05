import { useRef, type ReactNode } from 'react'
import { usePagination } from '@/hooks/usePagination'
import { PaginationControls } from '@/components/ui/pagination-controls'

/** Keep the DOM bounded while making every matching boundary reachable. */
export function PaginatedBoundaryList<T>({
  items,
  resetKey,
  label,
  children,
}: {
  items: readonly T[]
  resetKey: string
  label: string
  children: (item: T) => ReactNode
}) {
  const pagination = usePagination(items, 20, resetKey)
  const start = useRef<HTMLDivElement>(null)
  return (
    <div ref={start}>
      {pagination.items.map(children)}
      {pagination.pageCount > 1 && (
        <PaginationControls
          page={pagination.page}
          pageCount={pagination.pageCount}
          label={label}
          onPageChange={(page) => {
            pagination.setPage(page)
            start.current?.scrollIntoView({ block: 'start' })
          }}
        />
      )}
    </div>
  )
}
