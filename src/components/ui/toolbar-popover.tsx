import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnchoredPopover } from '@/components/ui/anchored-popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * An icon button that opens a small panel of form controls, so a narrow toolbar stays on one row
 * however wide its pane is. `count` shows how many of the panel's settings are active; focus moves
 * to the panel's `[data-autofocus]` control, else its first one, and Escape returns it to the button.
 * Mark one when the first control is an (i) help button, whose bubble would open over the panel.
 * Pass `children` as a function to close the panel from a control, such as one that starts work
 * elsewhere on the page.
 */
export function ToolbarPopover({
  label,
  icon,
  count = 0,
  align = 'start',
  width = 224,
  variant = 'outline',
  buttonClassName,
  children,
}: {
  /** Accessible name and tooltip of the button, and the name of the panel. */
  label: string
  icon: ReactNode
  count?: number
  align?: 'start' | 'end'
  width?: number
  /** `ghost` with `buttonClassName="size-8"` matches a panel header's icon buttons. */
  variant?: 'outline' | 'ghost'
  buttonClassName?: string
  children: ReactNode | ((close: () => void) => ReactNode)
}) {
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<Element | null>(null)
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() =>
      (
        panel.current?.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ??
        panel.current?.querySelector<HTMLElement>('input, select, textarea, button')
      )?.focus({ preventScroll: true }),
    )
    return () => cancelAnimationFrame(frame)
  }, [open])
  return (
    <>
      <Button
        ref={anchor}
        type="button"
        size="icon"
        variant={variant}
        className={cn('relative size-7 shrink-0', buttonClassName)}
        aria-label={count ? `${label}, ${count} active` : label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => {
          // An expanded panel stacks above the popover's level and keeps Tab inside itself.
          setContainer(anchor.current?.closest('[data-fullscreen]') ?? null)
          setOpen((value) => !value)
        }}
      >
        {icon}
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-3xs font-medium leading-none text-primary-foreground"
          >
            {count}
          </span>
        )}
      </Button>
      <AnchoredPopover
        anchorRef={anchor}
        panelRef={panel}
        container={container}
        open={open}
        onClose={close}
        align={align}
        width={width}
        role="dialog"
        ariaLabel={label}
      >
        {typeof children === 'function' ? children(close) : children}
      </AnchoredPopover>
    </>
  )
}

/** A setting in force, shown beside its toolbar button; pressing it clears that setting. */
export function ActiveFilterChip({
  label,
  clearLabel,
  onClear,
  className,
}: {
  label: string
  clearLabel: string
  onClear: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-6 max-w-40 shrink-0 items-center gap-1 rounded-full border bg-muted/50 pl-2 pr-1 text-2xs tabular-nums hover:bg-muted',
        className,
      )}
      aria-label={clearLabel}
      title={clearLabel}
      onClick={onClear}
    >
      <span className="min-w-0 truncate">{label}</span>
      <X className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}
