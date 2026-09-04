import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface RankedBarListItem {
  id: string
  label: ReactNode
  value: number
}

export function RankedBarList({
  items,
  limit,
  emptyMessage = 'No results',
  onSelect,
  className,
}: {
  items: RankedBarListItem[]
  limit?: number
  emptyMessage?: ReactNode
  onSelect?: (item: RankedBarListItem) => void
  className?: string
}) {
  const visibleItems = limit == null ? items : items.slice(0, limit)
  const maxValue = Math.max(1, ...visibleItems.map((item) => item.value))

  if (visibleItems.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <div className={cn('space-y-0.5', className)}>
      {visibleItems.map((item) => {
        const content = (
          <>
            <span className="min-w-0 flex-1 truncate text-left transition-colors group-hover:text-primary">
              {item.label}
            </span>
            <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary/50"
                style={{ width: `${(item.value / maxValue) * 100}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
              {item.value.toLocaleString()}
            </span>
          </>
        )

        return onSelect ? (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted"
          >
            {content}
          </button>
        ) : (
          <div key={item.id} className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs">
            {content}
          </div>
        )
      })}
    </div>
  )
}
