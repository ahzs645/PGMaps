import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ElementType,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react'
import { DatasetInfo, type DatasetInfoRecord } from '@/components/DatasetInfo'
import { cn } from '@/lib/utils'
import { MAP_OVERLAY_Z } from './map-overlay'
import { StatGroup, StatTileBody } from './stat-group'
import { isMobileViewport } from '@/hooks/useIsMobile'

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
        'absolute rounded-md border border-border bg-background/90 shadow-sm backdrop-blur-sm',
        MAP_OVERLAY_Z.controls,
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
  return <p className={cn('text-xs font-medium text-foreground', className)} {...props} />
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
        'absolute flex size-11 cursor-pointer items-center justify-center rounded-lg shadow-lg backdrop-blur-sm transition-colors md:size-10',
        MAP_OVERLAY_Z.controls,
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
        'flex size-11 cursor-pointer items-center justify-center border border-border transition-colors md:size-10',
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
        {label ? <div className="text-xs">{label}</div> : null}
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
        'flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-xs transition-colors hover:bg-accent disabled:pointer-events-none md:px-1',
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
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
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
    <label className={cn('flex cursor-pointer items-center gap-1.5 text-xs', className)} {...props}>
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
        'flex size-4 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-lg',
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
  /**
   * On phones the floating top bar already names the section, so the sheet
   * can drop its own title (kept for screen readers) and give the space to
   * the controls. Leave off when the sheet title says more than the top bar.
   */
  hideTitleOnMobile?: boolean
  /** Icon tile beside the title, for sections that brand their sidebar. */
  icon?: ElementType
  iconClassName?: string
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
  hideTitleOnMobile = false,
  icon,
  iconClassName,
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
        className={cn(hideTitleOnMobile && 'max-md:px-3 max-md:py-2', headerClassName)}
        titleClassName={cn(hideTitleOnMobile && 'max-md:sr-only', titleClassName)}
        icon={icon}
        iconClassName={iconClassName}
      />
      {dataset && <DatasetInfo dataset={dataset} />}
      <div data-map-sidebar-scroll="true" className={cn('min-h-0 flex-1 overflow-y-auto', scrollClassName, contentClassName)} {...restContentProps}>
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
  icon?: ElementType
  iconClassName?: string
}

export function MapSidebarHeader({
  title,
  subtitle,
  actions,
  className,
  titleClassName,
  icon: Icon,
  iconClassName,
}: MapSidebarHeaderProps) {
  return (
    <div className={cn('border-b border-border bg-background/95 p-4', className)}>
      <div className={cn(actions && 'flex items-start justify-between gap-3')}>
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary',
                iconClassName,
              )}
              aria-hidden="true"
            >
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className={cn('truncate text-xl font-bold text-foreground', titleClassName)}>{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  )
}

type SidebarSectionProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title?: ReactNode
  /** A line under the title, e.g. what the numbers below cover. */
  subtitle?: ReactNode
  icon?: ElementType
  iconClassName?: string
  actions?: ReactNode
  children: ReactNode
}

export function SidebarSection({
  title,
  subtitle,
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
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                {Icon && <Icon className={cn('h-4 w-4 text-muted-foreground', iconClassName)} />}
                <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
              </div>
              {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
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
  icon?: ReactNode
  loading?: boolean
  className?: string
  valueClassName?: string
}

/** A single small tile. Prefer `StatGroup` for new code; this wraps it for existing call sites. */
export function StatTile({ className, ...item }: StatTileProps) {
  return (
    <dl className="contents">
      <StatTileBody item={{ ...item, className }} size="sm" />
    </dl>
  )
}

type StatGridProps = {
  stats: StatTileProps[]
  columns?: 2 | 3 | 4
  className?: string
}

/** Small centred tiles in a fixed grid. Prefer `StatGroup variant="tiles" size="sm"` for new code. */
export function StatGrid({ stats, columns = 3, className }: StatGridProps) {
  return (
    <StatGroup
      variant="tiles"
      size="sm"
      columns={columns}
      className={className}
      items={stats.map((stat, index) => ({ ...stat, key: String(index) }))}
    />
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
  /** Tooltip explaining the chip, e.g. what a rule does. */
  title?: string
}

export function ToggleChip({ active, onClick, children, tone = 'sky', className, disabled, title }: ToggleChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      title={title}
      className={cn(
        'rounded border px-2 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50',
        active ? toggleChipToneClasses[tone] : 'border-input text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

type SearchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Show a magnifier inside the field. */
  icon?: boolean
  /** Show a clear button while the field has a value. */
  onClear?: () => void
  /** Classes for the wrapper when `icon` or `onClear` adds one. */
  wrapperClassName?: string
}

/**
 * The sidebar search field. 16px text on phones stops iOS Safari zooming the
 * page when the field takes focus; it drops to 14px from md up.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { className, icon = false, onClear, wrapperClassName, ...props },
  ref,
) {
  const input = (
    <input
      ref={ref}
      type="text"
      data-map-search-input="true"
      className={cn(
        'w-full rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring md:text-sm',
        icon && 'pl-9',
        onClear && 'pr-9',
        className,
      )}
      {...props}
    />
  )
  if (!icon && !onClear) return input

  const hasValue = props.value != null && String(props.value) !== ''
  return (
    <div className={cn('relative', wrapperClassName)}>
      {icon && (
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      )}
      {input}
      {onClear && hasValue && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground touch:h-9 touch:w-9"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
})

type FilterChipGroupItem<TValue extends string> = {
  value: TValue
  label: ReactNode
  count?: ReactNode
  color?: string
  disabled?: boolean
  /** Tooltip explaining the option. */
  title?: string
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
  /**
   * 'outline' (default) marks a selected chip by its coloured border alone.
   * 'filled' tints and ticks selected chips and dashes the rest, for groups
   * large enough that a border change is hard to scan.
   */
  variant?: 'outline' | 'filled'
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
  variant = 'outline',
}: FilterChipGroupProps<TValue>) {
  const filled = variant === 'filled'
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
            title={item.title}
            aria-pressed={selected}
            className={cn(
              'flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50 touch:min-h-9',
              layout === 'scroll' && 'shrink-0',
              selected
                ? filled
                  ? 'font-medium text-foreground'
                  : 'bg-background'
                : cn('border-input text-muted-foreground hover:bg-accent', filled && 'border-dashed'),
              selected && selectedClassName,
              chipClassName,
            )}
            style={
              selected && item.color
                ? filled
                  ? { borderColor: item.color, backgroundColor: `${item.color}1f` }
                  : { borderColor: item.color, color: item.color }
                : undefined
            }
          >
            {filled && selected && <Check className="h-3 w-3 shrink-0" style={{ color: item.color }} aria-hidden="true" />}
            {showDot && item.color && (
              <span
                className={cn('h-2 w-2 shrink-0 rounded-full', filled && !selected && 'opacity-40')}
                style={{ backgroundColor: item.color }}
              />
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
  children?: ReactNode
  tone?: 'info' | 'warning' | 'error' | 'success'
  /** Bold first line, e.g. "Could not load stations". */
  title?: ReactNode
  /** Leading spinner, for "Loading ..." notes. */
  loading?: boolean
  className?: string
}

/**
 * The one box for notes, warnings, errors and loading messages in sidebars
 * and dialogs. Errors are announced to screen readers.
 */
export function InlineAlert({ children, tone = 'info', title, loading = false, className }: InlineAlertProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : loading ? 'status' : undefined}
      className={cn(
        'rounded-md border p-2 text-xs leading-5',
        (loading || title) && 'flex items-start gap-2',
        tone === 'success' &&
          'border-green-300 bg-green-50 text-green-900 dark:border-green-900/60 dark:bg-green-950/35 dark:text-green-100',
        tone === 'info' && 'border-border bg-muted/20 text-muted-foreground',
        tone === 'warning' &&
          'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-100',
        tone === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
    >
      {loading && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />}
      {title ? (
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          {children}
        </div>
      ) : loading ? (
        <div className="min-w-0">{children}</div>
      ) : (
        children
      )}
    </div>
  )
}

export type KeyValueRow = { label: ReactNode; value: ReactNode; key?: string }

type KeyValueRowsProps = {
  rows: ReadonlyArray<KeyValueRow | null | false | undefined>
  /**
   * `stack` (default): label left, value right, no rules.
   * `divided`: the same with a hairline between rows, for detail cards.
   * `grid`: a two-column label/value grid, for dense popups.
   */
  variant?: 'stack' | 'divided' | 'grid'
  size?: 'xs' | 'sm'
  /** Cap on the value column in `stack`/`divided`; pass `null` to let values use the full width. */
  valueMaxWidth?: string | null
  className?: string
  labelClassName?: string
  valueClassName?: string
}

/**
 * Label/value rows for detail cards, popups and sidebars. Falsy rows are
 * skipped, so optional fields can be listed inline:
 * `rows={[{ label: 'Area', value }, hasDate && { label: 'Date', value: date }]}`.
 */
export function KeyValueRows({
  rows,
  variant = 'stack',
  size = 'xs',
  valueMaxWidth = 'max-w-[12rem]',
  className,
  labelClassName,
  valueClassName,
}: KeyValueRowsProps) {
  const visible = rows.filter((row): row is KeyValueRow => Boolean(row))
  const text = size === 'sm' ? 'text-sm' : 'text-xs'

  if (variant === 'grid') {
    return (
      <dl className={cn('grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-x-3 gap-y-1.5', text, className)}>
        {visible.map((row, index) => (
          <div key={row.key ?? index} className="contents">
            <dt className={cn('text-muted-foreground', labelClassName)}>{row.label}</dt>
            <dd className={cn('min-w-0 break-words font-medium text-foreground', valueClassName)}>{row.value}</dd>
          </div>
        ))}
      </dl>
    )
  }

  return (
    <dl className={cn(variant === 'divided' ? 'divide-y divide-border/70' : 'space-y-1', text, className)}>
      {visible.map((row, index) => (
        <div
          key={row.key ?? index}
          className={cn('flex items-start justify-between gap-3', variant === 'divided' && 'py-1.5 first:pt-0 last:pb-0')}
        >
          <dt className={cn('shrink-0 text-muted-foreground', labelClassName)}>{row.label}</dt>
          <dd className={cn('min-w-0 break-words text-right font-medium text-foreground', valueMaxWidth, valueClassName)}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
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

// Hover follows the card's tone; it used to be green whatever the tone.
const selectedItemHoverClasses: Record<SelectedItemTone, string> = {
  default: 'hover:bg-accent',
  sky: 'hover:bg-sky-100/80 dark:hover:bg-sky-950/50',
  cyan: 'hover:bg-cyan-100/80 dark:hover:bg-cyan-950/50',
  green: 'hover:bg-green-100/80 dark:hover:bg-green-950/50',
  amber: 'hover:bg-amber-100/80 dark:hover:bg-amber-950/50',
  orange: 'hover:bg-orange-100/80 dark:hover:bg-orange-950/50',
  blue: 'hover:bg-blue-100/80 dark:hover:bg-blue-950/50',
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
        selectedItemToneClasses[tone],
        onClick && cn('cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', selectedItemHoverClasses[tone]),
        className,
      )}
      {...interactiveProps}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && (
            <div className={cn('mb-0.5 text-xs font-medium', selectedItemSubtleTextClasses[tone])}>{eyebrow}</div>
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
  /** `'mobile'` starts collapsed on phones only, where the panel covers the map. */
  defaultCollapsed?: boolean | 'mobile'
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  contentClassName?: string
  elevated?: boolean
  /** 'fit' sizes the panel to its content (capped at the 'md' footprint)
   *  whether collapsed or expanded; the fixed sizes reserve their full width
   *  while expanded. */
  width?: 'sm' | 'md' | 'lg' | 'fit'
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
  const [internalCollapsed, setInternalCollapsed] = useState(() =>
    defaultCollapsed === 'mobile' ? isMobileViewport() : defaultCollapsed,
  )
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
      root.style.setProperty(
        '--map-legend-panel-visible-height',
        `${Math.ceil(panel.getBoundingClientRect().height) + 12}px`,
      )
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
        'absolute right-3 rounded-lg border border-border bg-background/95 p-2 shadow-xl backdrop-blur md:right-6 md:rounded-xl md:p-4',
        MAP_OVERLAY_Z.legend,
        elevated
          ? 'bottom-[calc(var(--map-mobile-sheet-visible-height,0px)_+_var(--map-timeline-height,0px)_+_var(--map-safe-bottom-offset,0px)_+_0.75rem)] md:bottom-[calc(var(--map-timeline-height,0px)_+_1.5rem)]'
          : 'bottom-[calc(var(--map-mobile-sheet-visible-height,0px)_+_var(--map-safe-bottom-offset,0px)_+_0.75rem)] md:bottom-6',
        // Collapsed, the pill shrinks to its title instead of keeping the
        // expanded panel's width as an empty box; the cap still stops long
        // descriptions from outgrowing the expanded footprint.
        width === 'sm' &&
          (isCollapsed ? 'w-auto max-w-[min(14rem,calc(100vw-2rem))]' : 'w-[min(14rem,calc(100vw-2rem))] md:w-56'),
        width === 'md' &&
          (isCollapsed ? 'w-auto max-w-[min(18rem,calc(100vw-2rem))]' : 'w-[min(18rem,calc(100vw-2rem))] md:w-auto'),
        width === 'lg' &&
          (isCollapsed ? 'w-auto max-w-[min(22rem,calc(100vw-2rem))]' : 'w-[min(22rem,calc(100vw-2rem))] md:w-88'),
        width === 'fit' && 'w-auto max-w-[min(18rem,calc(100vw-2rem))]',
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
                {actions ? <span className="text-xs">{actions}</span> : null}
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
              {actions ? <div className="shrink-0 text-xs">{actions}</div> : null}
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
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions ? <div className="flex items-center gap-2 text-xs">{actions}</div> : null}
            {value ? <span className="tabular-nums text-xs text-muted-foreground">{value}</span> : null}
          </div>
        </div>
      )}
      {!title && !value && !actions && description ? (
        <div className="text-xs leading-snug text-muted-foreground">{description}</div>
      ) : null}
      <div
        className={cn(
          columns === 2 ? 'grid grid-cols-2 gap-x-3 gap-y-0.5 md:gap-y-1' : 'space-y-0.5 md:space-y-1',
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
  swatch?: ReactNode
  className?: string
}

export function LegendItem({
  color,
  label,
  value,
  active = true,
  swatchShape = 'circle',
  swatch,
  className,
  onClick,
  type = 'button',
  ...props
}: LegendItemProps) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        {swatch ? (
          <span className={cn('flex shrink-0 transition-opacity', !active && 'opacity-35')}>{swatch}</span>
        ) : (
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
        )}
        <span className={cn('truncate', !active && 'line-through')}>{label}</span>
      </div>
      {value && <span className="shrink-0 tabular-nums text-xs">{value}</span>}
    </>
  )

  if (onClick) {
    return (
      <button
        type={type}
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded px-2 py-0.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:px-1',
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
  angledLabels?: boolean
  swatchShape?: 'square' | 'circle'
  getReadableTextColor?: (color: string) => string
}

export function MapSteppedLegend({
  bands,
  variant = 'strip',
  labels,
  showBandLabels = true,
  angledLabels = false,
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
    const gradient = `linear-gradient(to right, ${bands
      .map((band, index) => {
        const position = bands.length <= 1 ? 0 : (index / (bands.length - 1)) * 100
        return `${band.color} ${position}%`
      })
      .join(', ')})`

    return (
      <div className={cn('space-y-1.5', className)} {...props}>
        <div className="h-4 rounded-sm border border-border" style={{ background: gradient }} />
        {footerLabels.length > 0 && (
          <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground sm:text-xs">
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
      {footerLabels.length > 0 &&
        (angledLabels ? (
          <div
            className="grid h-12 pt-1 text-xs tabular-nums text-muted-foreground sm:text-xs"
            style={{ gridTemplateColumns: `repeat(${footerLabels.length}, minmax(0, 1fr))` }}
          >
            {footerLabels.map((label, index) => (
              <span key={`${String(label)}-${index}`} className="flex justify-end pr-4">
                <span className="inline-block origin-top-right -rotate-[35deg] whitespace-nowrap">{label}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1 text-xs tabular-nums text-muted-foreground sm:text-xs">
            {footerLabels.map((label, index) => (
              <span key={`${String(label)}-${index}`}>{label}</span>
            ))}
          </div>
        ))}
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
        'px-1 text-xs leading-snug',
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

type CollapsibleSectionProps = {
  /** Heading on the toggle row, e.g. "Map options" or "Factor weights". */
  label: ReactNode
  /** One line naming the current settings, shown beside the label while collapsed. */
  summary?: ReactNode
  /**
   * `mobile`: always open on desktop, folds on phones (sheet space is scarce).
   * `always`: a disclosure at every width.
   */
  collapseOn?: 'mobile' | 'always'
  defaultOpen?: boolean
  /** Controlled open state; pair with `onOpenChange`. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Controls on the toggle row that should not toggle it (e.g. a Reset link). */
  actions?: ReactNode
  /** Show `summary` only while collapsed (it usually repeats what the open section shows). */
  summaryWhenCollapsedOnly?: boolean
  /** Extra attributes for the toggle button, e.g. `data-*` hooks tests click. */
  toggleProps?: ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>
  children: ReactNode
  className?: string
  contentClassName?: string
}

/**
 * A section that folds to one line. One chevron style app-wide (a single
 * ChevronDown that rotates), with aria-expanded and a finger-sized row.
 */
export function CollapsibleSection({
  label,
  summary,
  collapseOn = 'always',
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  actions,
  summaryWhenCollapsedOnly = false,
  toggleProps,
  children,
  className,
  contentClassName,
}: CollapsibleSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = controlledOpen ?? internalOpen
  const contentId = useId()
  const mobileOnly = collapseOn === 'mobile'
  const toggle = () => {
    const next = !open
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <section className={cn('border-b border-border bg-background/95', className)}>
      <div className={cn('flex items-center gap-2 pr-3', mobileOnly && 'md:hidden')}>
        <button
          {...toggleProps}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left touch:min-h-11"
        >
          <span className="shrink-0 text-xs font-medium text-foreground">{label}</span>
          {summary && !(summaryWhenCollapsedOnly && open) && (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
          )}
          <ChevronDown
            className={cn('ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
        {actions}
      </div>
      <div id={contentId} className={cn(!open && (mobileOnly ? 'max-md:hidden' : 'hidden'), contentClassName)}>
        {children}
      </div>
    </section>
  )
}

type MobileCollapsibleSectionProps = {
  /** One line naming the current settings, shown on the collapsed phone row. */
  summary: ReactNode
  /** Label for the phone toggle, e.g. "Map options". */
  label: string
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}

/**
 * Settings that are always visible on desktop but fold into a one-line
 * summary on phones, so the half-open sheet reaches the list instead of
 * filling up with controls people set once.
 */
export function MobileCollapsibleSection(props: MobileCollapsibleSectionProps) {
  return <CollapsibleSection {...props} collapseOn="mobile" />
}
