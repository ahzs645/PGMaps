import type { ReactNode } from 'react'
import { X, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { cn } from '@/lib/utils'

/**
 * The card a map tool shows while it is in hand: pegging, extending, sketching, measuring a point.
 * One surface for all of them, floating over the map so starting a tool moves nothing:
 *
 * - a header with the tool's name, its explanation behind an (i), and a close button that names
 *   its key (`closeKeys`, usually Esc);
 * - an optional `hint`, the one line a person needs to start (what to click);
 * - the tool's own fields and readouts as children;
 * - an optional `status` line, amber when `statusTone="warning"`;
 * - `actions` in a footer, primary last so it sits at the right edge.
 *
 * Long help goes in `help`, never in the body. The host positions the card (`MapOverlay`, a pane's
 * corner); the card takes the width it is given.
 */
export function MapToolPanel({
  title,
  icon: Icon,
  help,
  helpLabel,
  onClose,
  closeLabel,
  closeKeys = 'Esc',
  hint,
  status,
  statusTone = 'default',
  actions,
  children,
  className,
  ...props
}: {
  title: ReactNode
  icon?: LucideIcon
  help?: ReactNode
  /** Accessible name of the (i), e.g. "About pegging at grade". */
  helpLabel?: string
  onClose?: () => void
  /** Accessible name of the close button, e.g. "Cancel pegging". */
  closeLabel?: string
  closeKeys?: string
  hint?: ReactNode
  status?: ReactNode
  statusTone?: 'default' | 'warning'
  actions?: ReactNode
  children?: ReactNode
  className?: string
  'aria-label': string
  'data-testid'?: string
}) {
  return (
    <section
      className={cn(
        'pointer-events-auto w-full overflow-hidden rounded-lg border bg-background/95 text-xs shadow-md backdrop-blur-sm',
        className,
      )}
      aria-label={props['aria-label']}
      data-testid={props['data-testid']}
      data-map-export-ignore
    >
      <header className="flex min-h-9 items-center gap-1.5 py-1 pl-3 pr-1">
        {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <h3 className="min-w-0 truncate text-xs font-semibold" title={typeof title === 'string' ? title : undefined}>
          {title}
        </h3>
        {help && (
          <InfoTip label={helpLabel ?? `About ${typeof title === 'string' ? title : 'this tool'}`}>{help}</InfoTip>
        )}
        {onClose && (
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto size-7 shrink-0"
            aria-label={closeLabel ?? 'Close'}
            title={closeKeys ? `${closeLabel ?? 'Close'} · ${closeKeys}` : closeLabel}
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </header>
      {(hint || children || status) && (
        <div className="space-y-2 px-3 pb-2.5">
          {hint && <p className="text-muted-foreground">{hint}</p>}
          {children}
          {status && (
            <p
              role="status"
              aria-live="polite"
              className={statusTone === 'warning' ? 'text-amber-800 dark:text-amber-300' : 'text-foreground'}
            >
              {status}
            </p>
          )}
        </div>
      )}
      {actions && (
        <footer className="flex items-center justify-end gap-1.5 border-t bg-muted/40 px-3 py-2">{actions}</footer>
      )}
    </section>
  )
}
