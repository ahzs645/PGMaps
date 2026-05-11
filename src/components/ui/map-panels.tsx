import type { ElementType, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type SidebarSectionProps = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode
  icon?: ElementType
  iconClassName?: string
  actions?: ReactNode
  children: ReactNode
}

export function SidebarSection({
  title,
  icon: Icon,
  iconClassName,
  actions,
  children,
  className,
  ...props
}: SidebarSectionProps) {
  return (
    <section className={cn('border-b border-border bg-background/95 p-4', className)} {...props}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <div className="flex min-w-0 items-center gap-2">
              {Icon && <Icon className={cn('h-4 w-4 text-muted-foreground', iconClassName)} />}
              <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
            </div>
          )}
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

type StatTileProps = {
  label: ReactNode
  value: ReactNode
  loading?: boolean
  className?: string
  valueClassName?: string
}

export function StatTile({ label, value, loading = false, className, valueClassName }: StatTileProps) {
  return (
    <div className={cn('rounded border border-border bg-background p-2 text-center', className)}>
      <div className={cn('text-sm font-bold text-foreground', valueClassName)}>{loading ? '...' : value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

type StatGridProps = {
  stats: StatTileProps[]
  columns?: 2 | 3 | 4
  className?: string
}

export function StatGrid({ stats, columns = 3, className }: StatGridProps) {
  return (
    <div
      className={cn(
        'grid gap-2',
        columns === 2 && 'grid-cols-2',
        columns === 3 && 'grid-cols-3',
        columns === 4 && 'grid-cols-2 sm:grid-cols-4',
        className,
      )}
    >
      {stats.map((stat, index) => (
        <StatTile key={index} {...stat} />
      ))}
    </div>
  )
}

type ToggleChipTone = 'sky' | 'orange' | 'teal' | 'cyan' | 'violet' | 'rose' | 'green' | 'amber'

const toggleChipToneClasses: Record<ToggleChipTone, string> = {
  sky: 'border-sky-500 text-sky-600 dark:text-sky-400',
  orange: 'border-orange-500 text-orange-600 dark:text-orange-400',
  teal: 'border-teal-500 text-teal-700 dark:text-teal-300',
  cyan: 'border-cyan-500 text-cyan-600 dark:text-cyan-400',
  violet: 'border-violet-500 text-violet-600 dark:text-violet-400',
  rose: 'border-rose-500 text-rose-600 dark:text-rose-400',
  green: 'border-green-500 text-green-700 dark:text-green-400',
  amber: 'border-amber-500 text-amber-700 dark:text-amber-400',
}

type ToggleChipProps = {
  active: boolean
  onClick: () => void
  children: ReactNode
  tone?: ToggleChipTone
  className?: string
  disabled?: boolean
}

export function ToggleChip({ active, onClick, children, tone = 'sky', className, disabled }: ToggleChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'rounded border px-2 py-1 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-50',
        active ? toggleChipToneClasses[tone] : 'border-input text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      className={cn(
        'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
        className,
      )}
      {...props}
    />
  )
}

type InlineAlertProps = {
  children: ReactNode
  tone?: 'info' | 'warning' | 'error'
  className?: string
}

export function InlineAlert({ children, tone = 'info', className }: InlineAlertProps) {
  return (
    <div
      className={cn(
        'rounded-md border p-2 text-xs leading-5',
        tone === 'info' && 'border-border bg-muted/20 text-muted-foreground',
        tone === 'warning' && 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-100',
        tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
    >
      {children}
    </div>
  )
}

type KeyValueRowsProps = {
  rows: Array<{ label: ReactNode; value: ReactNode }>
  className?: string
}

export function KeyValueRows({ rows, className }: KeyValueRowsProps) {
  return (
    <div className={cn('space-y-1 text-xs', className)}>
      {rows.map((row, index) => (
        <div key={index} className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="max-w-[12rem] text-right font-medium text-foreground">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

type SelectedItemCardProps = {
  title: ReactNode
  eyebrow?: ReactNode
  rows?: KeyValueRowsProps['rows']
  onClear?: () => void
  clearLabel?: string
  children?: ReactNode
  className?: string
}

export function SelectedItemCard({
  title,
  eyebrow,
  rows,
  onClear,
  clearLabel = 'Clear selection',
  children,
  className,
}: SelectedItemCardProps) {
  return (
    <div className={cn('rounded-md border border-border bg-background p-3 text-xs', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">{eyebrow}</div>}
          <div className="font-semibold leading-5 text-foreground">{title}</div>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={clearLabel}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {rows && <KeyValueRows rows={rows} className="mt-2" />}
      {children}
    </div>
  )
}

type MapLegendPanelProps = {
  children: ReactNode
  className?: string
}

export function MapLegendPanel({ children, className }: MapLegendPanelProps) {
  return (
    <div
      className={cn(
        'absolute bottom-[calc(var(--map-mobile-sheet-visible-height,72px)+0.75rem)] right-4 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-6 md:right-6',
        className,
      )}
    >
      {children}
    </div>
  )
}

type LegendItemProps = {
  color: string
  label: ReactNode
  value?: ReactNode
  className?: string
}

export function LegendItem({ color, label, value, className }: LegendItemProps) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate">{label}</span>
      </div>
      {value && <span className="shrink-0 tabular-nums text-[10px]">{value}</span>}
    </div>
  )
}
