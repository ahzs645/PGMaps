import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type MapPopupCardProps = {
  title: ReactNode
  /** Small label above the title, e.g. the layer name. */
  eyebrow?: ReactNode
  subtitle?: ReactNode
  /** Buttons or links under the content. */
  actions?: ReactNode
  /** Small controls beside the close button, e.g. a feature actions menu. */
  headerActions?: ReactNode
  onClose?: () => void
  closeLabel?: string
  children?: ReactNode
  className?: string
}

/**
 * The inside of a map popup or floating detail card: label, title, optional
 * close button, content (usually `KeyValueRows`), actions. The close button
 * always has a label and a finger-sized hit area on touch screens.
 */
export function MapPopupCard({
  title,
  eyebrow,
  subtitle,
  actions,
  headerActions,
  onClose,
  closeLabel = 'Close details',
  children,
  className,
}: MapPopupCardProps) {
  return (
    <div className={cn('min-w-0 space-y-2 text-xs', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</div>
          )}
          <div className="text-sm font-semibold leading-snug text-foreground">{title}</div>
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {(headerActions || onClose) && (
          <div className="-m-1 flex shrink-0 items-center gap-0.5">
            {headerActions}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground touch:p-3"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
      {children}
      {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
    </div>
  )
}
