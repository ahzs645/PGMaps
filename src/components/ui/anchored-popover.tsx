import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { MOTION_DURATION, useMotionPresence } from '@pgmaps/geo-toolkit/ui/motion'
import { usePanelPortalContainer } from '@pgmaps/geo-toolkit/ui/panel-portal'
import { cn } from '@/lib/utils'

const GAP = 6,
  MARGIN = 8
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Positions `panel` under its anchor, or above it without room below. Returns
 * false when the anchor has no size: it is in a hidden copy of the UI (for
 * example the mobile and desktop table bodies are both mounted).
 */
function placePanel(panel: HTMLElement | null, anchorElement: HTMLElement | null, align: 'start' | 'end'): boolean {
  const anchor = anchorElement?.getBoundingClientRect()
  if (!anchor || anchor.width === 0 || anchor.height === 0) return false
  if (!panel) return true
  // Measure layout dimensions: the feedback animation translates/scales the
  // surface, and its transformed bounds must not move the placement target.
  const size = { width: panel.offsetWidth, height: panel.offsetHeight }
  const view = anchorElement!.ownerDocument.defaultView!
  const viewportWidth = view.innerWidth
  const viewportHeight = view.innerHeight
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
    transformOrigin: `${align === 'end' ? 'right' : 'left'} ${below ? 'top' : 'bottom'}`,
  })
  panel.dataset.side = below ? 'bottom' : 'top'
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
  container,
  initialFocus = false,
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
  /** Portal target when `document.body` will not do, such as an expanded `FullscreenPanel`. */
  container?: Element | null
  /**
   * Move focus into the panel when it opens: to its `[data-autofocus]` element, else its first
   * control. For a panel opened from the keyboard on an element whose next Tab stop is not the
   * panel (it renders in a portal at the end of the page). The caller hands focus back on close.
   */
  initialFocus?: boolean
}) {
  const ownPanelRef = useRef<HTMLDivElement>(null)
  const panelContainer = usePanelPortalContainer()
  const panelRef = externalPanelRef ?? ownPanelRef
  const { present, visible } = useMotionPresence(open, MOTION_DURATION.feedback)

  useLayoutEffect(() => {
    const document = anchorRef.current?.ownerDocument ?? globalThis.document
    if (open && !placePanel(panelRef.current, anchorRef.current, align)) onClose()
    if (!open && panelRef.current?.contains(document.activeElement)) anchorRef.current?.focus()
  })

  useEffect(() => {
    if (!open || !initialFocus) return
    const document = anchorRef.current?.ownerDocument ?? globalThis.document
    const panel = panelRef.current
    if (!panel || panel.contains(document.activeElement)) return
    const target =
      panel.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ??
      panel.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus({ preventScroll: true })
    if (target?.tagName === 'INPUT') {
      try {
        ;(target as HTMLInputElement).select()
      } catch {
        /* Not every input type can be selected; focus is what matters. */
      }
    }
    // `present` too: the panel may mount a render after `open` turns on.
  }, [open, present, initialFocus, panelRef, anchorRef])

  useEffect(() => {
    if (!open) return
    const window = anchorRef.current?.ownerDocument.defaultView ?? globalThis.window
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
      anchorRef.current?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      // A dropdown or popover opened from inside this one renders in its own portal; choosing in it
      // is not a press outside.
      if ((target as Element).nodeType === 1 && (target as Element).closest('[data-floating-layer]')) return
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

  if (!present) return null
  return createPortal(
    <div
      ref={panelRef}
      data-floating-layer=""
      role={role}
      aria-label={ariaLabel}
      aria-hidden={!open || undefined}
      {...(!open ? { inert: '' } : {})}
      data-motion-state={open && visible ? 'open' : 'closed'}
      className={cn(
        'geo-motion-popover fixed z-[100] overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-xl',
        className,
      )}
      style={{ left: 0, top: 0, width, visibility: 'hidden', pointerEvents: open ? undefined : 'none' }}
    >
      {children}
    </div>,
    container ?? panelContainer ?? document.body,
  )
}
