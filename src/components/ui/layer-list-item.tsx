import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type LayerSwatchShape = 'fill' | 'line' | 'point'

/** The small mark that stands for a layer: a square for areas, a stroke for lines, a dot for points. */
export function LayerSwatch({
  color,
  shape,
  dimmed = false,
  className,
}: {
  color: string
  shape: LayerSwatchShape
  dimmed?: boolean
  className?: string
}) {
  const base = cn('block shrink-0 transition-opacity', dimmed && 'opacity-35', className)
  if (shape === 'line')
    return <span className={cn(base, 'h-1 w-5 rounded-full')} style={{ backgroundColor: color }} aria-hidden="true" />
  if (shape === 'point') {
    return (
      <span
        className={cn(base, 'size-3 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.2)]')}
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
    )
  }
  return (
    <span
      className={cn(base, 'size-4 rounded border')}
      style={{ backgroundColor: `${color}55`, borderColor: color }}
      aria-hidden="true"
    />
  )
}

/**
 * One layer in a Felt-style layer list, which is also the legend: swatch, name,
 * a line of facts, a visibility toggle and an overflow menu, with the layer's
 * legend rows underneath while it is shown.
 *
 * - `onOpen` makes the name a button (for example to open the layer's style panel).
 * - `actions` sits before the visibility toggle; pass an `ActionMenu`.
 * - `children` is the legend; it is hidden while the layer is switched off.
 */
export function LayerListItem({
  title,
  subtitle,
  swatch,
  visible,
  onVisibleChange,
  status = 'ready',
  statusLabel,
  selected = false,
  onOpen,
  openLabel,
  actions,
  children,
  className,
}: {
  title: string
  subtitle?: ReactNode
  swatch: ReactNode
  visible: boolean
  onVisibleChange: (visible: boolean) => void
  status?: 'ready' | 'loading' | 'error'
  /** Shown in place of `subtitle` while loading or failed, e.g. the error. */
  statusLabel?: string
  selected?: boolean
  onOpen?: () => void
  /** Accessible name for `onOpen`, e.g. "Style Sidewalks". Defaults to the title. */
  openLabel?: string
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const facts =
    status === 'loading'
      ? (statusLabel ?? 'Loading…')
      : status === 'error'
        ? (statusLabel ?? 'Failed to load')
        : subtitle
  const name = (
    <span className="min-w-0 flex-1">
      <span className={cn('block truncate text-sm font-medium', !visible && 'text-muted-foreground')}>{title}</span>
      {facts && (
        <span className={cn('block truncate text-xs text-muted-foreground', status === 'error' && 'text-destructive')}>
          {facts}
        </span>
      )}
    </span>
  )

  return (
    <div
      data-layer-item={title}
      data-visible={visible}
      className={cn(
        'group/layer rounded-md transition-colors',
        selected ? 'bg-primary/5 ring-1 ring-primary/40' : 'hover:bg-muted/50',
        className,
      )}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="flex w-5 shrink-0 justify-center">{swatch}</span>
        {onOpen ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={openLabel}
            onClick={onOpen}
          >
            {name}
          </button>
        ) : (
          name
        )}
        {status === 'loading' && (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
        {status === 'error' && <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />}
        {actions}
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:size-10"
          aria-label={visible ? `Hide ${title}` : `Show ${title}`}
          aria-pressed={visible}
          title={visible ? 'Hide layer' : 'Show layer'}
          onClick={() => onVisibleChange(!visible)}
        >
          {visible ? <Eye className="size-4" aria-hidden="true" /> : <EyeOff className="size-4" aria-hidden="true" />}
        </button>
      </div>
      {visible && children && <div className="pb-2 pl-9 pr-2">{children}</div>}
    </div>
  )
}
