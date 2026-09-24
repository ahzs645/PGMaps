import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { DialogShell, type DialogShellProps } from './dialog-shell'

type RecordDialogProps = Omit<DialogShellProps, 'footer' | 'onClose'> & {
  onClose: () => void
  /** Attribution shown in the footer, e.g. "Northern Health Authority HealthSpace". */
  source?: ReactNode
  sourceHref?: string
  sourceLinkLabel?: string
  /** Extra footer buttons placed before the source link, e.g. "Download report". */
  footerActions?: ReactNode
  /** Footer content on the left in place of the attribution, e.g. pagination. */
  footerStart?: ReactNode
}

/**
 * The shared layout for "one record, its history, and where the data came
 * from" dialogs: `DialogShell` plus a footer with attribution, the source
 * link and Close.
 */
export function RecordDialog({
  source,
  sourceHref,
  sourceLinkLabel = 'View source',
  footerActions,
  footerStart,
  onClose,
  ...props
}: RecordDialogProps) {
  return (
    <DialogShell
      {...props}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          {footerStart ?? (source && <div className="text-xs text-muted-foreground">Data from {source}</div>)}
          {/* The source link takes the spare width so its longer label never wraps beside Close. */}
          <div
            className={cn(
              'grid gap-2 sm:ml-auto sm:flex sm:gap-3',
              sourceHref || footerActions ? 'grid-cols-[1fr_auto]' : 'grid-cols-1',
            )}
          >
            {(footerActions || sourceHref) && (
              <div className="flex min-w-0 gap-2 sm:gap-3 [&>*]:flex-1 sm:[&>*]:flex-none">
                {footerActions}
                {sourceHref && (
                  <a
                    href={sourceHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    {sourceLinkLabel}
                  </a>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-lg border border-input bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent"
            >
              Close
            </button>
          </div>
        </div>
      }
    />
  )
}

/** The whole body when a record has nothing to show, instead of a page of zeros. */
export function RecordEmptyState({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mx-auto max-w-sm py-8 text-center', className)}>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-4 flex justify-center">{children}</div>}
    </div>
  )
}
