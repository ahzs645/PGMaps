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
  onExclude,
  selectedId,
  excludedIds,
  className,
}: {
  items: RankedBarListItem[]
  limit?: number
  emptyMessage?: ReactNode
  onSelect?: (item: RankedBarListItem) => void
  onExclude?: (item: RankedBarListItem) => void
  selectedId?: string | null
  excludedIds?: ReadonlySet<string>
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
          <div key={item.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSelect(item)}
              onContextMenu={
                onExclude
                  ? (event) => {
                      event.preventDefault()
                      onExclude(item)
                    }
                  : undefined
              }
              aria-pressed={selectedId === undefined ? undefined : selectedId === item.id}
              title={onExclude ? 'Click to filter and focus; right-click to exclude or restore' : undefined}
              className={cn(
                'group flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted touch:min-h-10',
                selectedId === item.id && 'bg-primary/10 ring-1 ring-inset ring-primary/30',
                excludedIds?.has(item.id) && 'text-muted-foreground line-through',
              )}
            >
              {content}
            </button>
            {onExclude && (
              <button
                type="button"
                onClick={() => onExclude(item)}
                aria-label={`${excludedIds?.has(item.id) ? 'Restore' : 'Exclude'} ${typeof item.label === 'string' ? item.label : item.id}`}
                title={excludedIds?.has(item.id) ? 'Restore location' : 'Exclude location'}
                className="shrink-0 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted touch:min-h-10"
              >
                {excludedIds?.has(item.id) ? '↶' : '−'}
              </button>
            )}
          </div>
        ) : (
          <div key={item.id} className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs">
            {content}
          </div>
        )
      })}
    </div>
  )
}
