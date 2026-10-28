import { Check, MoreHorizontal } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AnchoredPopover } from '@/components/ui/anchored-popover'
import { cn } from '@/lib/utils'

export type ActionMenuItem =
  | {
      type?: 'action'
      id: string
      label: string
      icon?: ReactNode
      onSelect: () => void
      disabled?: boolean
      tone?: 'default' | 'danger'
      /** Renders a checkbox (or, with `radio`, a radio) item and marks it when true. */
      checked?: boolean
      radio?: boolean
      /** Keep the menu open after choosing, for toggles. */
      keepOpen?: boolean
    }
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; label: string }

/**
 * An overflow ("⋯") menu: a trigger button and a list of actions in an anchored
 * popover. Arrow keys, Home and End move between items, Escape closes and returns
 * focus to the trigger. Pass `trigger` to replace the default icon with your own
 * content, for example a column header label.
 */
export function ActionMenu({
  label,
  items,
  trigger,
  triggerClassName,
  align = 'end',
  width = 224,
  onOpenChange,
}: {
  /** Accessible name of the trigger and the menu, e.g. "Options for Sidewalks". */
  label: string
  items: readonly (ActionMenuItem | false | null | undefined)[]
  trigger?: ReactNode
  triggerClassName?: string
  align?: 'start' | 'end'
  width?: number
  onOpenChange?: (open: boolean) => void
}) {
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpenState] = useState(false)
  const visibleItems = items.filter((item): item is ActionMenuItem => Boolean(item))

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )
  const close = useCallback(() => setOpen(false), [setOpen])

  const focusItem = (direction: 1 | -1 | 'first' | 'last') => {
    const options = [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[data-menu-item]:not(:disabled)') ?? []),
    ]
    if (options.length === 0) return
    const current = options.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      direction === 'first'
        ? 0
        : direction === 'last'
          ? options.length - 1
          : (current + direction + options.length) % options.length
    options[next]?.focus()
  }

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => focusItem('first'))
    return () => cancelAnimationFrame(frame)
  }, [open])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') focusItem(1)
    else if (event.key === 'ArrowUp') focusItem(-1)
    else if (event.key === 'Home') focusItem('first')
    else if (event.key === 'End') focusItem('last')
    else if (event.key === 'Tab') close()
    else return
    event.preventDefault()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={trigger ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={cn(
          trigger
            ? 'min-w-0'
            : 'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:size-10',
          open && !trigger && 'bg-muted text-foreground',
          triggerClassName,
        )}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(!open)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {trigger ?? <MoreHorizontal className="size-4" aria-hidden="true" />}
      </button>
      <AnchoredPopover
        anchorRef={triggerRef}
        panelRef={panelRef}
        open={open}
        onClose={close}
        align={align}
        width={width}
        className="py-1"
      >
        <div id={menuId} role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
          {visibleItems.map((item) => {
            if (item.type === 'separator') return <div key={item.id} role="separator" className="my-1 h-px bg-border" />
            if (item.type === 'label') {
              return (
                <div
                  key={item.id}
                  className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {item.label}
                </div>
              )
            }
            const checkable = item.checked !== undefined
            return (
              <button
                key={item.id}
                type="button"
                data-menu-item=""
                role={checkable ? (item.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem'}
                aria-checked={checkable ? item.checked : undefined}
                disabled={item.disabled}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-50 touch:py-3',
                  item.tone === 'danger' && 'text-destructive',
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  item.onSelect()
                  if (!item.keepOpen) {
                    close()
                    triggerRef.current?.focus()
                  }
                }}
              >
                {checkable ? (
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                    {item.checked && <Check className="size-4" />}
                  </span>
                ) : item.icon ? (
                  <span
                    className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      </AnchoredPopover>
    </>
  )
}
