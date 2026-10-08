import { useRef } from 'react'
import { cn } from '../utils.js'

export const DESKTOP_SIDEBAR_MIN_WIDTH = 240
export const DESKTOP_SIDEBAR_MAX_WIDTH = 520

/** Desktop-only vertical drag strip that reports a clamped sidebar width while dragging. */
export function SidebarResizeHandle({
  side,
  width,
  onWidthChange,
}: {
  side: 'left' | 'right'
  width: number
  onWidthChange: (width: number) => void
}) {
  const dragState = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize sidebar' : 'Resize right sidebar'}
      aria-valuemin={DESKTOP_SIDEBAR_MIN_WIDTH}
      aria-valuemax={DESKTOP_SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className={cn(
        'absolute inset-y-0 z-30 hidden w-2 cursor-col-resize touch-none transition-colors hover:bg-cyan-500/40 focus-visible:bg-cyan-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 workspace-desktop:block',
        side === 'left' ? 'right-0' : 'left-0',
      )}
      onKeyDown={(event) => {
        const direction = side === 'left' ? 1 : -1
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onWidthChange(Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, width - 10 * direction))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onWidthChange(Math.min(DESKTOP_SIDEBAR_MAX_WIDTH, width + 10 * direction))
        } else if (event.key === 'Home') {
          event.preventDefault()
          onWidthChange(DESKTOP_SIDEBAR_MIN_WIDTH)
        } else if (event.key === 'End') {
          event.preventDefault()
          onWidthChange(DESKTOP_SIDEBAR_MAX_WIDTH)
        }
      }}
      onPointerDown={(event) => {
        dragState.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      }}
      onPointerMove={(event) => {
        const drag = dragState.current
        if (!drag || drag.pointerId !== event.pointerId) return
        const delta = event.clientX - drag.startX
        const raw = side === 'left' ? drag.startWidth + delta : drag.startWidth - delta
        onWidthChange(Math.round(Math.min(DESKTOP_SIDEBAR_MAX_WIDTH, Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, raw))))
      }}
      onPointerUp={() => {
        dragState.current = null
      }}
      onPointerCancel={() => {
        dragState.current = null
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
