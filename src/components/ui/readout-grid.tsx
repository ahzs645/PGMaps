import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ReadoutItem = {
  label: string
  value: ReactNode
  /** Full name or definition, shown on hover, for an abbreviated label. */
  title?: string
  tone?: 'default' | 'warning'
}

/**
 * A dense engineering readout: abbreviated `label:` / right-aligned value pairs that fill as many
 * columns as the width allows, like the status block under a CAD section or profile window.
 * Falsy items are skipped so a host can list optional values inline.
 */
export function ReadoutGrid({
  items,
  className,
  minColumnWidth = '8.5rem',
  ...props
}: {
  items: Array<ReadoutItem | null | false | undefined>
  className?: string
  minColumnWidth?: string
  'data-testid'?: string
}) {
  return (
    <dl
      className={cn('grid gap-x-3 text-[10px] leading-4 tabular-nums', className)}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${minColumnWidth}, 100%), 1fr))` }}
      data-testid={props['data-testid']}
    >
      {items
        .filter((item): item is ReadoutItem => Boolean(item))
        .map((item) => (
          <div
            key={item.label}
            className="flex min-w-0 items-baseline justify-between gap-2 border-b border-dotted border-border/80"
            title={item.title}
          >
            <dt className="shrink-0 text-muted-foreground">{item.label}:</dt>
            <dd
              className={cn(
                'min-w-0 truncate text-right font-mono',
                item.tone === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-foreground',
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
    </dl>
  )
}
