/**
 * The active own photo kept beside the plan while its ground is laid on it (docs/forestry-visual-quality-own-photo-
 * redesign-2026-11-17.md, §2.4): the photo with what is drawn over it (`PhotoWithOverlays`, compact), its name and
 * where it stands, a way back to its window, and a close. Hovering the photo reports the ground under the pointer for
 * a marker on the plan; the plan's pointer comes back as a crosshair on the photo (`cursorPixel`). Hover takes no
 * clicks, so it needs nothing from the plan's click handlers.
 *
 * Props only, so the page decides where it docks: the page puts it to the right of the plan, in the plan's pane. It
 * is resizable by the grip on its left edge, between a third and a half of that row by default and never more than
 * half, so the plan keeps room to be read; the width lasts the visit.
 */
import { useRef, useState, type PointerEvent } from 'react'
import { GripVertical, Maximize2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { PHOTO_STATUS_TEXT } from './photoOptions'
import type { PhotoPageFeatures } from './photoPageFeatures'
import { PhotoWithOverlays } from './PhotoWithOverlays'
import type { FieldPhotoState } from './useFieldPhoto'

const MIN_WIDTH = 220
const DEFAULT_WIDTH = 380
/** The most of the row the pane takes: the plan beside it keeps the rest. */
const MAX_SHARE = 0.5

export function DockedPhotoPane({
  photo,
  cursorPixel = null,
  onHoverGround,
  onClose,
  onOpenWindow,
  pageFeatures,
  className,
}: {
  photo: FieldPhotoState
  /** What the page holds for the layers the photo cannot read itself (`photoPageFeatures.ts`). */
  pageFeatures?: PhotoPageFeatures
  /** Where the plan's pointer falls in the photo; null when off it. */
  cursorPixel?: { x: number; y: number } | null
  /** The ground under the pointer on the photo; null when it leaves. */
  onHoverGround?: (point: { lng: number; lat: number } | null) => void
  onClose: () => void
  onOpenWindow: () => void
  className?: string
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const drag = useRef<{ x: number; width: number; pointer: number; max: number } | null>(null)
  const own = photo.own
  if (!own) return null
  const entry = photo.queue.entries.find((row) => row.recordId === own.id)
  const acceptance = photo.acceptanceState(own.id)
  const status =
    acceptance === 'lapsed'
      ? 'Acceptance lapsed: the camera moved'
      : entry
        ? PHOTO_STATUS_TEXT[entry.status]
        : acceptance === 'accepted'
          ? PHOTO_STATUS_TEXT.accepted
          : null

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const row =
      event.currentTarget.closest('section')?.parentElement?.getBoundingClientRect().width ?? window.innerWidth
    drag.current = { x: event.clientX, width, pointer: event.pointerId, max: Math.max(MIN_WIDTH, row * MAX_SHARE) }
  }
  // The grip is on the left edge, next to the plan: dragging it left widens the pane.
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    setWidth(Math.max(MIN_WIDTH, Math.min(current.max, current.width - (event.clientX - current.x))))
  }

  return (
    <section
      className={cn(
        'relative max-h-full max-w-[50%] min-w-0 shrink-0 self-start overflow-y-auto rounded-lg border bg-popover p-2 pl-3.5 text-xs shadow-lg',
        className,
      )}
      style={{ width }}
      aria-label="Your photo, beside the plan"
      data-testid="docked-photo-pane"
    >
      <header className="mb-1.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{own.name}</p>
          {status && <p className="truncate text-2xs text-muted-foreground">{status}</p>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Open the photo’s window"
          title="Open the window"
          onClick={onOpenWindow}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Close the photo pane" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>
      <PhotoWithOverlays
        photo={photo}
        compact
        cursorPixel={cursorPixel}
        onHoverGround={onHoverGround}
        pageFeatures={pageFeatures}
        imageClassName="max-h-[45vh]"
        toolbar={
          <Button type="button" variant="ghost" size="xs" className="ml-auto touch:h-10" onClick={onOpenWindow}>
            Open the window
          </Button>
        }
      />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the photo pane"
        className="absolute inset-y-2 left-0 flex w-3 cursor-ew-resize touch-none items-center justify-center text-muted-foreground"
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <GripVertical className="h-4 w-4" />
      </div>
    </section>
  )
}
