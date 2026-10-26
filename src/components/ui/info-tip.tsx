import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

const GAP = 6,
  MARGIN = 8

/**
 * Help text behind an (i) button: hover or focus shows it, a click or tap pins it, Escape or
 * leaving closes it. The bubble renders in a portal at fixed position, so a scrolling sidebar or
 * an `overflow-hidden` card cannot clip it. Use it for explanations a reader needs once, not for
 * a warning they must see: those stay inline (`InlineAlert`).
 */
export function InfoTip({
  label,
  children,
  showLabel = false,
  className,
  bubbleClassName,
}: {
  /** Accessible name of the button, e.g. "About section reach". */
  label: string
  children: ReactNode
  /** Print `label` beside the icon instead of keeping it for screen readers only. */
  showLabel?: boolean
  className?: string
  bubbleClassName?: string
}) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const close = useCallback(() => {
    setOpen(false)
    setPinned(false)
  }, [])
  const place = useCallback(() => {
    const anchor = button.current?.getBoundingClientRect(),
      size = bubble.current?.getBoundingClientRect()
    if (!anchor || !size) return
    const width = window.innerWidth,
      height = window.innerHeight
    const left = Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - size.width / 2),
      width - size.width - MARGIN,
    )
    const below = anchor.bottom + GAP
    const top = below + size.height <= height - MARGIN ? below : Math.max(MARGIN, anchor.top - GAP - size.height)
    // Written straight to the element: it is measured first, so it cannot be placed in render.
    Object.assign(bubble.current!.style, {
      left: `${Math.max(MARGIN, left)}px`,
      top: `${top}px`,
      visibility: 'visible',
    })
  }, [])
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])
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
          pinned && 'text-foreground',
        )}
        onFocus={() => setOpen(true)}
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
        <Info className="size-3.5" aria-hidden="true" />
        {showLabel && label}
      </button>
      {open &&
        createPortal(
          <span
            ref={bubble}
            role="tooltip"
            id={id}
            style={{ left: 0, top: 0, visibility: 'hidden' }}
            className={cn(
              'fixed z-[1000] block w-72 max-w-[calc(100vw-16px)] whitespace-normal rounded-lg border bg-popover p-3 text-left text-xs font-normal leading-5 text-popover-foreground shadow-lg',
              bubbleClassName,
            )}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  )
}
