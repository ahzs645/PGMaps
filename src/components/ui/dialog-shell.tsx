import type { HTMLAttributes, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

const sizeClasses = {
  md: 'sm:max-w-2xl',
  lg: 'sm:max-w-4xl',
  xl: 'sm:max-w-5xl',
} as const

export interface DialogShellProps {
  title: ReactNode
  /** Where the record is, or what the panel is for. */
  subtitle?: ReactNode
  /** Small uppercase label above the title, e.g. "Sampling report". */
  eyebrow?: ReactNode
  /** One line under the subtitle naming the slice being shown, e.g. the period. */
  context?: ReactNode
  /** Controls that change what the body shows: a period switch, a `TabBar`, a search field. */
  toolbar?: ReactNode
  /** Headline numbers, usually a `StatGroup variant="tiles"`. */
  summary?: ReactNode
  /** Anything else that belongs in the fixed header (notes, badges). */
  headerExtra?: ReactNode
  /** Footer row; omit for none. */
  footer?: ReactNode
  /** Accessible name for the header close button. */
  closeLabel?: string
  size?: keyof typeof sizeClasses
  /** Controlled open state. Defaults to open, for dialogs mounted only while shown. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Called on Escape, overlay click and both close buttons. */
  onClose?: () => void
  /**
   * The button that opens the dialog. Passing it here lets focus return to it
   * on close (Radix only restores focus to its own trigger).
   */
  trigger?: ReactNode
  /** Extra classes for the dialog panel, e.g. a fixed height. */
  className?: string
  bodyClassName?: string
  /** Attributes for the dialog panel, e.g. `data-*` test hooks. */
  contentProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | boolean | undefined>
  children: ReactNode
}

/**
 * The frame every large dialog shares: a pinned title row with a
 * finger-sized close button, an optional header (controls, numbers, notes),
 * a scrolling body and an optional footer. A bottom sheet on phones, a
 * centred modal from `sm` up, raised above the map toolbar.
 *
 * On phones only the title row stays pinned and the rest of the header
 * scrolls with the body, so a tall header cannot squeeze the content.
 */
export function DialogShell({
  title,
  subtitle,
  eyebrow,
  context,
  toolbar,
  summary,
  headerExtra,
  footer,
  closeLabel = 'Close',
  size = 'lg',
  open = true,
  onOpenChange,
  onClose,
  trigger,
  className,
  bodyClassName,
  contentProps,
  children,
}: DialogShellProps) {
  const hasExtras = Boolean(toolbar || summary || headerExtra)
  const close = () => {
    onClose?.()
    onOpenChange?.(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
        else onOpenChange?.(true)
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        variant="sheet"
        elevated
        showClose={false}
        className={cn('max-h-[96dvh] sm:max-h-[92dvh]', sizeClasses[size], className)}
        {...contentProps}
      >
        {/* Title row: pinned at every width. */}
        <header
          className={cn(
            'flex shrink-0 items-start justify-between gap-3 bg-background/90 p-4 sm:p-6',
            hasExtras ? 'max-sm:border-b max-sm:border-border sm:pb-3' : 'border-b border-border',
          )}
        >
          <div className="min-w-0">
            {eyebrow && (
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{eyebrow}</div>
            )}
            <DialogTitle className="text-lg font-bold leading-tight text-foreground sm:text-xl">{title}</DialogTitle>
            {subtitle ? (
              <DialogDescription className="mt-1 text-sm leading-snug text-muted-foreground">{subtitle}</DialogDescription>
            ) : (
              // Radix warns without a description; an empty one keeps the title as the only label.
              <DialogDescription className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogDescription>
            )}
            {context && <p className="mt-1 text-xs font-medium text-sky-700 dark:text-sky-400">{context}</p>}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={closeLabel}
            className="-m-1 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground touch:p-2.5"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        {/*
          Phones: controls, numbers and notes scroll away with the content so
          it is not squeezed under a half-screen header. From sm up they stay
          fixed and only the content scrolls.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain sm:flex sm:flex-col sm:overflow-hidden">
          {hasExtras && (
            <div className="space-y-3 border-b border-border bg-background/90 p-4 sm:shrink-0 sm:px-6 sm:pb-6 sm:pt-0">
              {toolbar}
              {summary}
              {headerExtra}
            </div>
          )}
          <div className={cn('bg-muted/20 p-3 sm:min-h-0 sm:flex-1 sm:overflow-y-auto sm:overscroll-contain sm:p-6', bodyClassName)}>
            {children}
          </div>
        </div>

        {footer && (
          <footer className="shrink-0 border-t border-border bg-background/90 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4">
            {footer}
          </footer>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Settings, pickers and libraries: `DialogShell` with an optional footer and
 * a plain background body. Use `RecordDialog` for one record's history.
 */
export function PanelDialog({ bodyClassName, ...props }: DialogShellProps) {
  return <DialogShell {...props} bodyClassName={cn('bg-background', bodyClassName)} />
}
