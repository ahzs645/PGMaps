import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Info, TriangleAlert } from 'lucide-react'
import { MOTION_DURATION, useMotionPresence } from '@pgmaps/geo-toolkit/ui/motion'
import { cn } from '@/lib/utils'

const GAP = 6,
  MARGIN = 8
/** How long the pointer rests on a `HoverTip`'s control before its bubble opens. */
const HOVER_DELAY_MS = 350
/** Above the overlay scrollbar's thumb (`.overlay-scrollbar`, z-index 2147483000), which is drawn over every scroller. */
const BUBBLE_CLASS =
  'geo-motion-popover fixed z-[2147483100] block w-72 max-w-[calc(100vw-16px)] whitespace-normal rounded-lg border bg-popover p-3 text-left text-xs font-normal leading-5 text-popover-foreground shadow-lg'

/** Puts a bubble under its anchor, or above it without room below, inside the window. */
function placeBubble(anchor: DOMRect, panel: HTMLElement) {
  // The animated surface's scale must not change its placement calculation.
  const size = { width: panel.offsetWidth, height: panel.offsetHeight }
  const width = window.innerWidth,
    height = window.innerHeight
  const left = Math.min(Math.max(MARGIN, anchor.left + anchor.width / 2 - size.width / 2), width - size.width - MARGIN)
  const below = anchor.bottom + GAP
  const fitsBelow = below + size.height <= height - MARGIN
  const top = fitsBelow ? below : Math.max(MARGIN, anchor.top - GAP - size.height)
  // Written straight to the element: it is measured first, so it cannot be placed in render.
  Object.assign(panel.style, {
    left: `${Math.max(MARGIN, left)}px`,
    top: `${top}px`,
    visibility: 'visible',
    transformOrigin: `center ${fitsBelow ? 'top' : 'bottom'}`,
  })
  panel.dataset.side = fitsBelow ? 'bottom' : 'top'
}

/**
 * Help text behind an (i) button: hover or focus shows it, a click or tap pins it, Escape or
 * leaving closes it. The bubble renders in a portal at fixed position above dialogs, so a
 * scrolling sidebar or an `overflow-hidden` card cannot clip it. Use it for explanations a reader needs once, not for
 * a warning they must see: those stay inline (`InlineAlert`). The exception is a standing caveat
 * that is not news, such as screening-grade terrain, or a status in a panel header with no room for
 * a sentence, such as the cross-section's incomplete section: `tone="warning"` keeps an amber
 * triangle in view and puts its wording behind it.
 */
export function InfoTip({
  label,
  children,
  showLabel = false,
  className,
  bubbleClassName,
  tone = 'info',
}: {
  /** Accessible name of the button, e.g. "About section reach". */
  label: string
  children: ReactNode
  /** Print `label` beside the icon instead of keeping it for screen readers only. */
  showLabel?: boolean
  className?: string
  bubbleClassName?: string
  /** `warning` shows an amber triangle instead of the (i). */
  tone?: 'info' | 'warning'
}) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const restoringFocus = useRef(false)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const { present, visible } = useMotionPresence(open, MOTION_DURATION.feedback)
  const close = useCallback(() => {
    setOpen(false)
    setPinned(false)
  }, [])
  const place = useCallback(() => {
    const anchor = button.current?.getBoundingClientRect()
    if (anchor && bubble.current) placeBubble(anchor, bubble.current)
  }, [])
  useLayoutEffect(() => {
    if (open) place()
    else if (bubble.current?.contains(document.activeElement)) {
      restoringFocus.current = true
      button.current?.focus()
      restoringFocus.current = false
    }
  }, [open, present, place])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!button.current?.contains(target) && !bubble.current?.contains(target)) close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, close, place])
  return (
    <span
      className={cn('inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) close()
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          showLabel ? 'px-1 py-1 text-xs' : 'size-5 justify-center',
          // A 40 px touch target without moving the 20 px icon or its neighbours.
          "touch:after:absolute touch:after:-inset-2.5 touch:after:content-['']",
          !className?.includes('absolute') && 'relative',
          pinned && 'text-foreground',
        )}
        onFocus={() => {
          if (!restoringFocus.current) setOpen(true)
        }}
        onBlur={(event) => {
          if (!bubble.current?.contains(event.relatedTarget as Node | null)) close()
        }}
        onClick={() => {
          if (open && pinned) close()
          else {
            setOpen(true)
            setPinned(true)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation()
            close()
          }
        }}
      >
        {tone === 'warning' ? (
          <TriangleAlert className="size-3.5 text-amber-500 dark:text-amber-400" aria-hidden="true" />
        ) : (
          <Info className="size-3.5" aria-hidden="true" />
        )}
        {showLabel && label}
      </button>
      {present &&
        createPortal(
          <span
            ref={bubble}
            role="tooltip"
            id={id}
            aria-hidden={!open || undefined}
            {...(!open ? { inert: '' } : {})}
            data-motion-state={open && visible ? 'open' : 'closed'}
            style={{ left: 0, top: 0, visibility: 'hidden', pointerEvents: open ? undefined : 'none' }}
            className={cn(BUBBLE_CLASS, bubbleClassName)}
          >
            {children}
          </span>,
          // A fullscreen workspace shows only its own subtree, so the bubble goes there.
          document.fullscreenElement ?? document.body,
        )}
    </span>
  )
}

/**
 * `InfoTip`'s bubble on a control of its own: resting the pointer on the child, or reaching it with the keyboard,
 * shows `content`; leaving, pressing, Escape or blur closes it. Use it where a button's own hover should say what
 * the button does, in place of a native `title`. The bubble takes no pointer events and cannot be pinned, so keep
 * links and anything a reader must act on out of it. The child must be one element that takes `aria-describedby`.
 */
export function HoverTip({
  content,
  children,
  bubbleClassName,
}: {
  content: ReactNode
  children: ReactElement<{ 'aria-describedby'?: string }>
  bubbleClassName?: string
}) {
  const id = useId()
  const wrapper = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
  // A press focuses the control too: that focus must not reopen what the press closed.
  const pressed = useRef(false)
  const [open, setOpen] = useState(false)
  const { present, visible } = useMotionPresence(open, MOTION_DURATION.feedback)
  const close = useCallback(() => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }, [])
  const place = useCallback(() => {
    const anchor = wrapper.current?.firstElementChild
    if (anchor && bubble.current) placeBubble(anchor.getBoundingClientRect(), bubble.current)
  }, [])
  useLayoutEffect(() => {
    if (open) place()
  }, [open, present, place])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, close, place])
  return (
    // `contents`: the child stays its parent's own grid or flex item.
    <span
      ref={wrapper}
      className="contents"
      onPointerEnter={(event) => {
        // A touch has no hover: its tap presses the control.
        if (event.pointerType !== 'mouse') return
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS)
      }}
      onPointerLeave={close}
      onPointerDown={() => {
        pressed.current = true
        close()
      }}
      onFocus={() => {
        if (!pressed.current) setOpen(true)
        pressed.current = false
      }}
      onBlur={() => {
        pressed.current = false
        close()
      }}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      {present &&
        createPortal(
          <span
            ref={bubble}
            role="tooltip"
            id={id}
            aria-hidden={!open || undefined}
            data-motion-state={open && visible ? 'open' : 'closed'}
            style={{ left: 0, top: 0, visibility: 'hidden', pointerEvents: 'none' }}
            className={cn(BUBBLE_CLASS, bubbleClassName)}
          >
            {content}
          </span>,
          // A fullscreen workspace shows only its own subtree, so the bubble goes there.
          document.fullscreenElement ?? document.body,
        )}
    </span>
  )
}
