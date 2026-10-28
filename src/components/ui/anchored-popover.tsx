import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

const GAP = 6,
  MARGIN = 8

/**
 * Positions `panel` under its anchor, or above it without room below. Returns
 * false when the anchor has no size: it is in a hidden copy of the UI (for
 * example the mobile and desktop table bodies are both mounted).
 */
function placePanel(panel: HTMLElement | null, anchorElement: HTMLElement | null, align: 'start' | 'end'): boolean {
  const anchor = anchorElement?.getBoundingClientRect()
  if (!anchor || anchor.width === 0 || anchor.height === 0) return false
  if (!panel) return true
  const size = panel.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const preferredLeft = align === 'end' ? anchor.right - size.width : anchor.left
  const left = Math.min(Math.max(MARGIN, preferredLeft), viewportWidth - size.width - MARGIN)
  const roomBelow = viewportHeight - anchor.bottom - GAP - MARGIN
  const roomAbove = anchor.top - GAP - MARGIN
  const below = size.height <= roomBelow || roomBelow >= roomAbove
  Object.assign(panel.style, {
    left: `${Math.max(MARGIN, left)}px`,
    top: below
      ? `${anchor.bottom + GAP}px`
      : `${Math.max(MARGIN, anchor.top - GAP - Math.min(size.height, roomAbove))}px`,
    maxHeight: `${Math.max(120, below ? roomBelow : roomAbove)}px`,
    visibility: 'visible',
  })
  return true
}

/**
 * A floating panel pinned under (or, without room, above) an anchor element. It
 * renders in a portal at fixed position, so a scrolling sidebar or table cannot
 * clip it, and closes on Escape, on a press outside it and its anchor, and when
 * the anchor is hidden. `ActionMenu` is built on it; use it directly for small
 * read-only panels such as column statistics.
 *
 * Not for use inside a modal dialog: the portal sits outside the dialog's focus
 * trap. Keep dialog menus inline there.
 */
export function AnchoredPopover({
  anchorRef,
  open,
  onClose,
  children,
  align = 'start',
  width,
  className,
  role,
  ariaLabel,
  panelRef: externalPanelRef,
}: {
  anchorRef: RefObject<HTMLElement>
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Which anchor edge the panel lines up with. */
  align?: 'start' | 'end'
  /** Fixed width in px; otherwise the panel sizes to its content. */
  width?: number
  className?: string
  role?: string
  ariaLabel?: string
  panelRef?: RefObject<HTMLDivElement>
}) {
  const ownPanelRef = useRef<HTMLDivElement>(null)
  const panelRef = externalPanelRef ?? ownPanelRef

  useLayoutEffect(() => {
    if (open && !placePanel(panelRef.current, anchorRef.current, align)) onClose()
  })

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
      anchorRef.current?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      onClose()
    }
    const place = () => {
      if (!placePanel(panelRef.current, anchorRef.current, align)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [align, anchorRef, onClose, open, panelRef])

  if (!open) return null
  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-label={ariaLabel}
      className={cn(
        'fixed z-[100] overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-xl',
        className,
      )}
      style={{ left: 0, top: 0, width, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}
