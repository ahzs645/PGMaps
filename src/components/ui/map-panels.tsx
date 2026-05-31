import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ElementType,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ChevronDown, X } from 'lucide-react'
import { DatasetInfo, type DatasetInfoRecord } from '@/components/DatasetInfo'
import { cn } from '@/lib/utils'

const overlayPositions = {
  'top-left': 'top-3 left-3',
  'top-right': 'top-3 right-3',
  'bottom-left': 'bottom-3 left-3',
  'bottom-right': 'right-3 bottom-3',
  'top-center': 'top-3 left-1/2 -translate-x-1/2',
  'bottom-center': 'bottom-3 left-1/2 -translate-x-1/2',
} as const

export type MapOverlayPosition = keyof typeof overlayPositions

type MapOverlayProps = ComponentPropsWithoutRef<'div'> & {
  position?: MapOverlayPosition
}

export function MapOverlay({ position = 'top-left', className, children, ...props }: MapOverlayProps) {
  return (
    <div
      className={cn(
        'absolute z-10 rounded-md border border-border bg-background/90 shadow-sm backdrop-blur-sm',
        overlayPositions[position],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function MapOverlayHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('mb-2', className)} {...props} />
}

export function MapOverlayTitle({ className, ...props }: ComponentPropsWithoutRef<'p'>) {
  return <p className={cn('text-[10px] font-medium text-foreground', className)} {...props} />
}

export function MapOverlayContent({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('space-y-1', className)} {...props} />
}

export function MapPanel({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'max-h-[calc(100%-5rem)] overflow-auto rounded-xl bg-background/95 shadow-lg backdrop-blur-sm',
        className,
      )}
      {...props}
    />
  )
}

export function MapPanelHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('border-b border-border p-3', className)} {...props} />
}

export function MapPanelTitle({ className, ...props }: ComponentPropsWithoutRef<'h2'>) {
  return <h2 className={cn('text-sm font-semibold', className)} {...props} />
}

export function MapPanelDescription({ className, ...props }: ComponentPropsWithoutRef<'p'>) {
  return <p className={cn('mt-1 text-xs text-muted-foreground', className)} {...props} />
}

export function MapPanelContent({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('p-3', className)} {...props} />
}

export function MapPanelFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('px-3 pb-3', className)} {...props} />
}

type MapFloatingButtonProps = ComponentPropsWithoutRef<'button'> & {
  active?: boolean
  position?: MapOverlayPosition
}

export function MapFloatingButton({
  active = false,
  position = 'top-left',
  className,
  type = 'button',
  ...props
}: MapFloatingButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'absolute z-10 flex size-9 cursor-pointer items-center justify-center rounded-lg shadow-lg backdrop-blur-sm transition-colors',
        overlayPositions[position],
        active ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-background/95 hover:bg-accent',
        className,
      )}
      {...props}
    />
  )
}

type MapToolbarButtonProps = ComponentPropsWithoutRef<'button'> & {
  active?: boolean
  shape?: 'circle' | 'square'
}

export function MapToolbarButton({
  active = false,
  shape = 'square',
  className,
  type = 'button',
  ...props
}: MapToolbarButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'flex size-9 cursor-pointer items-center justify-center border border-border transition-colors',
        shape === 'circle' ? 'rounded-full' : 'rounded-md',
        active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
        className,
      )}
      {...props}
    />
  )
}

type MapStatProps = ComponentPropsWithoutRef<'div'> & {
  icon?: ReactNode
  label?: ReactNode
  value: ReactNode
  inline?: boolean
}

export function MapStat({ icon, label, value, inline = false, className, ...props }: MapStatProps) {
  return (
    <div className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)} {...props}>
      {icon}
      <div className={cn(inline && 'contents')}>
        <div className={cn('font-medium', inline ? 'text-muted-foreground' : 'text-foreground')}>{value}</div>
        {label ? <div className="text-[10px]">{label}</div> : null}
      </div>
    </div>
  )
}

type MapSwatchProps = ComponentPropsWithoutRef<'span'> & {
  color?: string
  active?: boolean
  shape?: 'dot' | 'square' | 'line'
}

export function MapSwatch({ color, active = true, shape = 'square', className, style, ...props }: MapSwatchProps) {
  return (
    <span
      className={cn(
        'shrink-0 border',
        shape === 'dot' && 'size-2.5 rounded-full',
        shape === 'square' && 'size-2.5 rounded-sm',
        shape === 'line' && 'h-0.5 w-4 rounded-full border-0',
        className,
      )}
      style={{
        backgroundColor: active ? color : 'transparent',
        borderColor: color,
        ...style,
      }}
      {...props}
    />
  )
}

type MapLegendProps = MapOverlayProps & {
  title?: ReactNode
  collapsible?: boolean
  defaultCollapsed?: boolean
}

export function MapLegend({
  title,
  collapsible = false,
  defaultCollapsed = false,
  className,
  children,
  ...props
}: MapLegendProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <MapOverlay className={cn('p-2', className)} {...props}>
      {title ? (
        <MapOverlayHeader className={cn(!collapsed && 'mb-2')}>
          {collapsible ? (
            <button
              type="button"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((value) => !value)}
              className="flex w-full items-center justify-between gap-3 text-left hover:text-foreground"
            >
              <MapOverlayTitle>{title}</MapOverlayTitle>
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform',
                  collapsed && '-rotate-90',
                )}
              />
            </button>
          ) : (
            <MapOverlayTitle>{title}</MapOverlayTitle>
          )}
        </MapOverlayHeader>
      ) : null}
      {!collapsed ? <MapOverlayContent>{children}</MapOverlayContent> : null}
    </MapOverlay>
  )
}

type MapLegendItemProps = ComponentPropsWithoutRef<'button'> & {
  color?: string
  label: ReactNode
  active?: boolean
  swatchShape?: MapSwatchProps['shape']
}

export function MapLegendItem({
  color,
  label,
  active = true,
  swatchShape = 'square',
  className,
  disabled,
  ...props
}: MapLegendItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] transition-colors hover:bg-accent disabled:pointer-events-none',
        className,
      )}
      {...props}
    >
      <MapSwatch color={color} active={active} shape={swatchShape} />
      <span className={cn(!active && 'text-muted-foreground line-through')}>{label}</span>
    </button>
  )
}

type MapGradientLegendItemProps = ComponentPropsWithoutRef<'div'> & {
  colors: readonly string[]
  minLabel: ReactNode
  maxLabel: ReactNode
}

export function MapGradientLegendItem({
  colors,
  minLabel,
  maxLabel,
  className,
  style,
  ...props
}: MapGradientLegendItemProps) {
  return (
    <div className={cn('min-w-24 space-y-1', className)} {...props}>
      <div
        className="h-2 rounded-sm border"
        style={{
          background: `linear-gradient(to right, ${colors.join(', ')})`,
          ...style,
        }}
      />
      <div className="flex items-center justify-between gap-3 text-[9px] text-muted-foreground">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  )
}

type MapLayerToggleProps = ComponentPropsWithoutRef<'label'> & {
  color?: string
  label: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

export function MapLayerToggle({ color, label, checked, onCheckedChange, className, ...props }: MapLayerToggleProps) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-1.5 text-[10px]', className)} {...props}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="size-3 accent-primary"
      />
      <MapSwatch color={color} active={checked} />
      {label}
    </label>
  )
}

type MapMarkerDotProps = ComponentPropsWithoutRef<'div'> & {
  color?: string
}

export function MapMarkerDot({ color, className, style, ...props }: MapMarkerDotProps) {
  return (
    <div
      className={cn('size-3.5 rounded-full border-2 border-white shadow-lg', className)}
      style={{ backgroundColor: color, ...style }}
      {...props}
    />
  )
}

type MapNumberedMarkerProps = ComponentPropsWithoutRef<'div'> & {
  color?: string
  label: ReactNode
}

export function MapNumberedMarker({ color, label, className, style, ...props }: MapNumberedMarkerProps) {
  return (
    <div
      className={cn(
        'flex size-4 items-center justify-center rounded-full border-2 border-white text-[9px] font-bold text-white shadow-lg',
        className,
      )}
      style={{ backgroundColor: color, ...style }}
      {...props}
    >
      {label}
    </div>
  )
}

type MapSidebarShellProps = HTMLAttributes<HTMLDivElement> & {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  dataset?: DatasetInfoRecord
  children: ReactNode
  scrollClassName?: string
  headerClassName?: string
  titleClassName?: string
  contentProps?: HTMLAttributes<HTMLDivElement>
}

export function MapSidebarShell({
  title,
  subtitle,
  actions,
  dataset,
  children,
  className,
  scrollClassName,
  headerClassName,
  titleClassName,
  contentProps,
  ...props
}: MapSidebarShellProps) {
  const { className: contentClassName, ...restContentProps } = contentProps ?? {}

  return (
    <div
      className={cn(
        'z-10 flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur',
        className,
      )}
      {...props}
    >
      <MapSidebarHeader
        title={title}
        subtitle={subtitle}
        actions={actions}
        className={headerClassName}
        titleClassName={titleClassName}
      />
      {dataset && <DatasetInfo dataset={dataset} />}
      <div className={cn('min-h-0 flex-1 overflow-y-auto', scrollClassName, contentClassName)} {...restContentProps}>
        {children}
      </div>
    </div>
  )
}

type MapSidebarHeaderProps = {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
  titleClassName?: string
}

export function MapSidebarHeader({ title, subtitle, actions, className, titleClassName }: MapSidebarHeaderProps) {
  return (
    <div className={cn('border-b border-border bg-background/95 p-4', className)}>
      <div className={cn(actions && 'flex items-start justify-between gap-3')}>
        <div className="min-w-0">
          <h1 className={cn('truncate text-xl font-bold text-foreground', titleClassName)}>{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  )
}

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
      data-map-search-input="true"
      className={cn(
        'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
        className,
      )}
      {...props}
    />
  )
}

type FilterChipGroupItem<TValue extends string> = {
  value: TValue
  label: ReactNode
  count?: ReactNode
  color?: string
  disabled?: boolean
}

type FilterChipGroupProps<TValue extends string> = {
  items: Array<FilterChipGroupItem<TValue>>
  selectedValues: readonly TValue[]
  onToggle: (value: TValue) => void
  layout?: 'wrap' | 'scroll' | 'grid'
  columns?: 2 | 3
  className?: string
  chipClassName?: string
  selectedClassName?: string
  showDot?: boolean
}

export function FilterChipGroup<TValue extends string>({
  items,
  selectedValues,
  onToggle,
  layout = 'wrap',
  columns = 3,
  className,
  chipClassName,
  selectedClassName,
  showDot = true,
}: FilterChipGroupProps<TValue>) {
  const selectedSet = new Set(selectedValues)

  return (
    <div
      className={cn(
        layout === 'wrap' && 'flex flex-wrap gap-1.5',
        layout === 'scroll' && 'flex gap-1.5 overflow-x-auto pb-1 pr-1',
        layout === 'grid' && 'grid gap-2',
        layout === 'grid' && columns === 2 && 'grid-cols-2',
        layout === 'grid' && columns === 3 && 'grid-cols-3',
        className,
      )}
    >
      {items.map((item) => {
        const selected = selectedSet.has(item.value)
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onToggle(item.value)}
            disabled={item.disabled}
            aria-pressed={selected}
            className={cn(
              'flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50',
              layout === 'scroll' && 'shrink-0',
              selected ? 'bg-background' : 'border-input text-muted-foreground hover:bg-accent',
              selected && selectedClassName,
              chipClassName,
            )}
            style={selected && item.color ? { borderColor: item.color, color: item.color } : undefined}
          >
            {showDot && item.color && (
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            )}
            <span className="truncate">{item.label}</span>
            {item.count !== undefined && <span className="shrink-0 tabular-nums opacity-70">{item.count}</span>}
          </button>
        )
      })}
    </div>
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
        tone === 'warning' &&
          'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-100',
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

type SelectedItemTone = 'default' | 'sky' | 'cyan' | 'green' | 'amber' | 'orange' | 'blue'

const selectedItemToneClasses: Record<SelectedItemTone, string> = {
  default: 'border-border bg-background text-foreground',
  sky: 'border-sky-300/60 bg-sky-50 text-sky-900 dark:border-sky-800/60 dark:bg-sky-950/30 dark:text-sky-100',
  cyan: 'border-cyan-300/50 bg-cyan-50 text-cyan-900 dark:border-cyan-900/70 dark:bg-cyan-950/25 dark:text-cyan-100',
  green:
    'border-green-300/60 bg-green-50 text-green-900 dark:border-green-800/60 dark:bg-green-950/30 dark:text-green-100',
  amber:
    'border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-100',
  orange:
    'border-orange-300/60 bg-orange-50 text-orange-900 dark:border-orange-800/60 dark:bg-orange-950/25 dark:text-orange-100',
  blue: 'border-blue-300/60 bg-blue-50 text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/25 dark:text-blue-100',
}

const selectedItemSubtleTextClasses: Record<SelectedItemTone, string> = {
  default: 'text-muted-foreground',
  sky: 'text-sky-700 dark:text-sky-300',
  cyan: 'text-cyan-700 dark:text-cyan-300',
  green: 'text-green-700 dark:text-green-300',
  amber: 'text-amber-700 dark:text-amber-300',
  orange: 'text-orange-700 dark:text-orange-300',
  blue: 'text-blue-700 dark:text-blue-300',
}

type SelectedItemCardProps = {
  title: ReactNode
  eyebrow?: ReactNode
  subtitle?: ReactNode
  tone?: SelectedItemTone
  badges?: ReactNode
  actions?: ReactNode
  rows?: KeyValueRowsProps['rows']
  onClear?: () => void
  onClick?: () => void
  clearLabel?: string
  children?: ReactNode
  className?: string
}

export function SelectedItemCard({
  title,
  eyebrow,
  subtitle,
  tone = 'default',
  badges,
  actions,
  rows,
  onClear,
  onClick,
  clearLabel = 'Clear selection',
  children,
  className,
}: SelectedItemCardProps) {
  const interactiveProps = onClick
    ? {
        role: 'button',
        tabIndex: 0,
        onClick,
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick()
          }
        },
      }
    : {}

  return (
    <div
      className={cn(
        'rounded-md border p-3 text-xs',
        onClick && 'cursor-pointer transition-colors hover:bg-green-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 dark:hover:bg-green-950/50',
        selectedItemToneClasses[tone],
        className,
      )}
      {...interactiveProps}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && (
            <div className={cn('mb-0.5 text-[10px] font-medium', selectedItemSubtleTextClasses[tone])}>{eyebrow}</div>
          )}
          <div className="font-semibold leading-5">{title}</div>
          {subtitle && <div className={cn('text-xs', selectedItemSubtleTextClasses[tone])}>{subtitle}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {onClear && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onClear()
              }}
              className={cn('shrink-0 transition-colors hover:text-foreground', selectedItemSubtleTextClasses[tone])}
              aria-label={clearLabel}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {badges && <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div>}
      {rows && <KeyValueRows rows={rows} className="mt-2" />}
      {children}
    </div>
  )
}

type MapLegendPanelProps = {
  children: ReactNode
  className?: string
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  collapsible?: boolean
  defaultCollapsed?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  contentClassName?: string
  elevated?: boolean
  width?: 'sm' | 'md' | 'lg'
}

export function MapLegendPanel({
  children,
  className,
  title,
  description,
  icon,
  actions,
  collapsible = false,
  defaultCollapsed = false,
  collapsed,
  onCollapsedChange,
  contentClassName,
  elevated = false,
  width = 'md',
}: MapLegendPanelProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const panelRef = useRef<HTMLDivElement>(null)
  const isCollapsed = collapsed ?? internalCollapsed
  const toggleCollapsed = () => {
    const next = !isCollapsed
    onCollapsedChange?.(next)
    if (collapsed === undefined) {
      setInternalCollapsed(next)
    }
  }

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const root = panel.closest<HTMLElement>('[data-map-layout-root="true"]')
    if (!root) return

    const syncLegendHeight = () => {
      root.style.setProperty('--map-legend-panel-visible-height', `${Math.ceil(panel.getBoundingClientRect().height) + 12}px`)
    }
    syncLegendHeight()

    const observer = new ResizeObserver(syncLegendHeight)
    observer.observe(panel)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--map-legend-panel-visible-height')
    }
  }, [])

  return (
    <div
      ref={panelRef}
      className={cn(
        'absolute right-3 z-10 rounded-lg border border-border bg-background/95 p-2 shadow-xl backdrop-blur md:right-6 md:rounded-xl md:p-4',
        elevated
          ? 'bottom-[calc(var(--map-mobile-sheet-visible-height,72px)_+_var(--map-timeline-height,5.5rem)_+_0.75rem)] md:bottom-[calc(var(--map-timeline-height,5.5rem)_+_1.5rem)]'
          : 'bottom-[calc(var(--map-mobile-sheet-visible-height,72px)+0.75rem)] md:bottom-6',
        width === 'sm' && 'w-[min(14rem,calc(100vw-2rem))] md:w-56',
        width === 'md' && 'w-[min(18rem,calc(100vw-2rem))] md:w-auto',
        width === 'lg' && 'w-[min(22rem,calc(100vw-2rem))] md:w-88',
        className,
      )}
    >
      {title && (
        <div className={cn(!isCollapsed && 'mb-2')}>
          {collapsible ? (
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={toggleCollapsed}
                className="flex min-w-0 flex-1 items-start gap-1.5 text-left hover:text-foreground"
              >
                {icon ? <span className="mt-px shrink-0 text-muted-foreground">{icon}</span> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-foreground">{title}</span>
                  {description ? (
                    <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{description}</span>
                  ) : null}
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-2">
                {actions ? <span className="text-[10px]">{actions}</span> : null}
                <button
                  type="button"
                  aria-label={isCollapsed ? 'Expand legend' : 'Collapse legend'}
                  aria-expanded={!isCollapsed}
                  onClick={toggleCollapsed}
                  className="mt-0.5 text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={cn('size-3.5 transition-transform', isCollapsed && '-rotate-90')} />
                </button>
              </span>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground">
                  {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
                  <span className="truncate">{title}</span>
                </h4>
                {description ? (
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{description}</div>
                ) : null}
              </div>
              {actions ? <div className="shrink-0 text-[10px]">{actions}</div> : null}
            </div>
          )}
        </div>
      )}
      {!isCollapsed ? <div className={contentClassName}>{children}</div> : null}
    </div>
  )
}

type MapLegendSectionProps = ComponentPropsWithoutRef<'div'> & {
  title?: ReactNode
  value?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  columns?: 1 | 2
  scroll?: boolean
}

export function MapLegendSection({
  title,
  value,
  description,
  actions,
  columns = 1,
  scroll = false,
  className,
  children,
  ...props
}: MapLegendSectionProps) {
  return (
    <div className={cn('space-y-1.5 text-xs text-muted-foreground', className)} {...props}>
      {(title || value || actions) && (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {title ? <span className="block truncate font-medium text-foreground">{title}</span> : null}
            {description ? (
              <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">{description}</span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions ? <div className="flex items-center gap-2 text-[10px]">{actions}</div> : null}
            {value ? <span className="tabular-nums text-[10px] text-muted-foreground">{value}</span> : null}
          </div>
        </div>
      )}
      {!title && !value && !actions && description ? (
        <div className="text-[10px] leading-snug text-muted-foreground">{description}</div>
      ) : null}
      <div
        className={cn(
          columns === 2 ? 'grid grid-cols-2 gap-x-3 gap-y-1' : 'space-y-1',
          scroll && 'max-h-44 overflow-y-auto pr-1',
        )}
      >
        {children}
      </div>
    </div>
  )
}

type LegendItemProps = Omit<ComponentPropsWithoutRef<'button'>, 'color'> & {
  color: string
  label: ReactNode
  value?: ReactNode
  active?: boolean
  swatchShape?: 'circle' | 'square' | 'line' | 'dashed-line'
  className?: string
}

export function LegendItem({
  color,
  label,
  value,
  active = true,
  swatchShape = 'circle',
  className,
  onClick,
  type = 'button',
  ...props
}: LegendItemProps) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'shrink-0 transition-opacity',
            swatchShape === 'circle' ? 'rounded-full' : 'rounded-sm',
            swatchShape === 'line' || swatchShape === 'dashed-line' ? 'h-0.5 w-5' : 'h-2.5 w-2.5',
            !active && 'opacity-35',
          )}
          style={
            swatchShape === 'dashed-line'
              ? { backgroundImage: `repeating-linear-gradient(to right, ${color} 0 5px, transparent 5px 8px)` }
              : { backgroundColor: color }
          }
        />
        <span className={cn('truncate', !active && 'line-through')}>{label}</span>
      </div>
      {value && <span className="shrink-0 tabular-nums text-[10px]">{value}</span>}
    </>
  )

  if (onClick) {
    return (
      <button
        type={type}
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !active && 'text-muted-foreground',
          className,
        )}
        {...props}
      >
        {content}
      </button>
    )
  }

  return (
    <div className={cn('flex items-center justify-between gap-2', !active && 'text-muted-foreground', className)}>
      {content}
    </div>
  )
}

type MapSteppedLegendBand = {
  label: ReactNode
  color: string
  textColor?: string
  swatchLabel?: ReactNode
}

type MapSteppedLegendProps = ComponentPropsWithoutRef<'div'> & {
  bands: readonly MapSteppedLegendBand[]
  variant?: 'strip' | 'rows' | 'gradient'
  labels?: ReactNode[]
  showBandLabels?: boolean
  swatchShape?: 'square' | 'circle'
  getReadableTextColor?: (color: string) => string
}

export function MapSteppedLegend({
  bands,
  variant = 'strip',
  labels,
  showBandLabels = true,
  swatchShape = 'square',
  getReadableTextColor,
  className,
  ...props
}: MapSteppedLegendProps) {
  if (variant === 'rows') {
    return (
      <div className={cn('space-y-1.5', className)} {...props}>
        {bands.map((band, index) => (
          <div key={`${String(band.label)}-${index}`} className="flex items-center gap-3 text-xs text-muted-foreground">
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center border border-black/10 text-xs font-bold',
                swatchShape === 'circle' ? 'rounded-full' : 'rounded',
              )}
              style={{
                backgroundColor: band.color,
                color: band.textColor ?? getReadableTextColor?.(band.color),
              }}
            >
              {showBandLabels ? (band.swatchLabel ?? band.label) : null}
            </span>
            <span className="text-foreground">{band.label}</span>
          </div>
        ))}
      </div>
    )
  }

  const footerLabels = labels ?? bands.map((band) => band.label)

  if (variant === 'gradient') {
    const gradient = `linear-gradient(to right, ${bands.map((band, index) => {
      const position = bands.length <= 1 ? 0 : (index / (bands.length - 1)) * 100
      return `${band.color} ${position}%`
    }).join(', ')})`

    return (
      <div className={cn('space-y-1.5', className)} {...props}>
        <div
          className="h-4 rounded-sm border border-border"
          style={{ background: gradient }}
        />
        {footerLabels.length > 0 && (
          <div className="flex items-center justify-between gap-2 text-[9px] tabular-nums text-muted-foreground sm:text-[10px]">
            {footerLabels.map((label, index) => (
              <span key={`${String(label)}-${index}`}>{label}</span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn('space-y-1', className)} {...props}>
      <div
        className="grid overflow-hidden rounded-sm border border-border"
        style={{ gridTemplateColumns: `repeat(${bands.length}, minmax(0, 1fr))` }}
      >
        {bands.map((band, index) => (
          <span key={`${String(band.label)}-${index}`} className="block h-3" style={{ backgroundColor: band.color }} />
        ))}
      </div>
      {footerLabels.length > 0 && (
        <div className="flex items-center justify-between gap-1 text-[9px] tabular-nums text-muted-foreground sm:text-[10px]">
          {footerLabels.map((label, index) => (
            <span key={`${String(label)}-${index}`}>{label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

type MapSizeLegendProps = ComponentPropsWithoutRef<'div'> & {
  minLabel: ReactNode
  maxLabel: ReactNode
  sizes?: number[]
  color?: string
  shape?: 'circle' | 'square'
}

export function MapSizeLegend({
  minLabel,
  maxLabel,
  sizes = [8, 16, 28],
  color = '#94a3b8',
  shape = 'circle',
  className,
  ...props
}: MapSizeLegendProps) {
  return (
    <div className={cn('flex items-center justify-between gap-2 text-xs text-muted-foreground', className)} {...props}>
      <span>{minLabel}</span>
      <div className="flex min-h-7 items-center gap-1.5">
        {sizes.map((size) => (
          <span
            key={size}
            className={cn('border border-white shadow-sm', shape === 'circle' ? 'rounded-full' : 'rounded-sm')}
            style={{ width: size, height: size, backgroundColor: color }}
          />
        ))}
      </div>
      <span>{maxLabel}</span>
    </div>
  )
}

type MapImageLegendProps = ComponentPropsWithoutRef<'div'> & {
  src: string
  alt: string
  label?: ReactNode
  maxHeight?: number
}

export function MapImageLegend({ src, alt, label, maxHeight = 96, className, ...props }: MapImageLegendProps) {
  return (
    <div className={cn('rounded-md border border-border bg-secondary/30 p-3 text-xs', className)} {...props}>
      {label ? <div className="mb-2 font-medium text-foreground">{label}</div> : null}
      <img src={src} alt={alt} className="max-w-full rounded bg-white object-contain" style={{ maxHeight }} />
    </div>
  )
}

type MapLegendNoteProps = ComponentPropsWithoutRef<'div'> & {
  tone?: 'muted' | 'warning' | 'error'
}

export function MapLegendNote({ tone = 'muted', className, ...props }: MapLegendNoteProps) {
  return (
    <div
      className={cn(
        'px-1 text-[10px] leading-snug',
        tone === 'muted' && 'text-muted-foreground',
        tone === 'warning' &&
          'rounded border border-amber-200 bg-amber-50 px-2 py-1 font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
        tone === 'error' &&
          'rounded border border-destructive/30 bg-destructive/10 px-2 py-1 font-medium text-destructive',
        className,
      )}
      {...props}
    />
  )
}
