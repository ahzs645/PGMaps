import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface StatItem {
  label: ReactNode
  /** Shorter label for narrow tiles on phones, e.g. "Insp." for "Inspections". */
  shortLabel?: ReactNode
  value: ReactNode
  tone?: 'default' | 'danger' | 'warning' | 'success' | 'muted' | 'primary'
  /** Text values (dates, ratings) render smaller than counts and may wrap. */
  compact?: boolean
  icon?: ReactNode
  /** Shows an ellipsis in place of the value while it loads. */
  loading?: boolean
  /** A line under the label, e.g. "vs 2021" or a source note. */
  note?: ReactNode
  /** React key when `label` is not a plain string. */
  key?: string
  className?: string
  valueClassName?: string
}

const toneClasses: Record<NonNullable<StatItem['tone']>, string> = {
  default: 'text-foreground',
  danger: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  success: 'text-green-600 dark:text-green-400',
  muted: 'text-muted-foreground',
  primary: 'text-primary',
}

const columnClasses = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-5',
} as const

interface StatGroupProps {
  items: readonly StatItem[]
  /**
   * `inline`: a centred row of bare numbers for sidebars.
   * `tiles`: bordered tiles for dialogs, reports and sidebar summaries.
   */
  variant?: 'inline' | 'tiles'
  /** Tile size: `sm` for dense sidebar grids, `md` for dialogs and reports. */
  size?: 'sm' | 'md'
  /** Tile text alignment. Defaults to centred for `sm`, start for `md`. */
  align?: 'start' | 'center'
  /** Fixed column count; omit to fit as many tiles per row as the width allows. */
  columns?: keyof typeof columnClasses
  className?: string
}

function itemKey(item: StatItem, index: number): string {
  return item.key ?? (typeof item.label === 'string' ? item.label : String(index))
}

function StatLabel({ item }: { item: StatItem }) {
  if (!item.shortLabel) return <>{item.label}</>
  return (
    <>
      <span className="sm:hidden">{item.shortLabel}</span>
      <span className="max-sm:hidden">{item.label}</span>
    </>
  )
}

/** One stat tile. Must sit inside a `<dl>`; `StatGroup` and `StatTile` provide one. */
export function StatTileBody({
  item,
  size = 'md',
  align = size === 'sm' ? 'center' : 'start',
}: {
  item: StatItem
  size?: 'sm' | 'md'
  align?: 'start' | 'center'
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col-reverse rounded-lg border border-border',
        size === 'sm' ? 'bg-background p-2' : 'bg-muted/40 px-2 py-2 sm:px-3',
        align === 'center' && 'items-center text-center',
        item.className,
      )}
    >
      {item.note && <div className="text-[11px] leading-snug text-muted-foreground">{item.note}</div>}
      {/* Uppercase only for md tiles from sm up: tracked capitals overflow a quarter-width phone tile. */}
      <dt className={cn('max-w-full truncate text-xs text-muted-foreground', size === 'md' && 'sm:uppercase sm:tracking-wide')}>
        <StatLabel item={item} />
      </dt>
      <dd
        className={cn(
          'max-w-full font-bold tabular-nums',
          size === 'sm'
            ? 'text-sm'
            : // Counts stay on one line; text values (a connection size, a
              // date) wrap rather than lose their ending to an ellipsis.
              item.compact
              ? 'text-base leading-tight sm:text-lg'
              : 'truncate text-lg sm:text-2xl',
          toneClasses[item.tone ?? 'default'],
          item.valueClassName,
        )}
      >
        {item.loading ? '...' : item.value}
      </dd>
      {item.icon && (
        <div className={cn('mb-0.5 flex text-primary', align === 'center' && 'justify-center')} aria-hidden="true">
          {item.icon}
        </div>
      )}
    </div>
  )
}

/**
 * Headline numbers, shared by map sidebars, dialogs and reports. This is the
 * one stat component: `StatGrid`/`StatTile` in map-panels are thin wrappers
 * kept for existing call sites.
 */
export function StatGroup({ items, variant = 'inline', size = 'md', align, columns, className }: StatGroupProps) {
  if (variant === 'tiles') {
    return (
      <dl
        className={cn(
          'grid',
          columns ? columnClasses[columns] : 'grid-cols-[repeat(auto-fit,minmax(4.75rem,1fr))]',
          size === 'sm' ? 'gap-2' : 'gap-1.5 sm:gap-3',
          className,
        )}
      >
        {items.map((item, index) => (
          <StatTileBody key={itemKey(item, index)} item={item} size={size} align={align} />
        ))}
      </dl>
    )
  }

  return (
    <dl className={cn('flex items-center justify-around gap-2 text-center', className)}>
      {items.map((item, index) => (
        <div key={itemKey(item, index)} className={cn('flex flex-col-reverse whitespace-nowrap', item.className)}>
          <dt className="text-xs text-muted-foreground">
            <StatLabel item={item} />
          </dt>
          <dd
            className={cn(
              'text-base font-bold tabular-nums md:text-lg',
              toneClasses[item.tone ?? 'default'],
              item.valueClassName,
            )}
          >
            {item.loading ? '...' : item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
