/**
 * A picture that can be zoomed and panned in the box it is given, as a map can: the wheel or a pinch zooms about the
 * pointer, a drag moves a zoomed picture, and the buttons in its corner step in, step out and fit it again. Everything
 * inside (the picture, and whatever is laid over it) is scaled together by one CSS transform, so marks placed in
 * percent of the picture stay on their spots, and `getBoundingClientRect` on anything inside still answers in screen
 * pixels. `docs/shared-ui.md`, **Zoom and pan**.
 *
 * The content's box is the viewport's own: centre a picture in it. A mark that must keep its size on screen while the
 * picture grows (a numbered pin, a card) reads `--zoom-pan-scale`, e.g. `scale: calc(1 / var(--zoom-pan-scale, 1))`.
 * A control inside that takes its own drags or clicks carries `data-zoom-pan-ignore`.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'

import { cn } from '@/lib/utils'

import { clampView, zoomAbout, FIT_VIEW, type ZoomPanView } from './zoomPanView'

export type ZoomPanProps = {
  children: ReactNode
  /** What is zoomed, for the buttons' names: "photo" gives "Zoom in on the photo". */
  label?: string
  /** The most the picture is enlarged over its fitted size. */
  maxScale?: number
  /** A change of this value fits the picture again: another picture, another tab. */
  resetKey?: string | number | null
  /** Told the scale whenever it changes, for content that draws finer when enlarged. */
  onScaleChange?: (scale: number) => void
  /**
   * The view, when its holder keeps it: two pictures of one size set side by side share one, so they zoom and move
   * together. With it goes `onViewChange`; `resetKey` is then the holder's business.
   */
  view?: ZoomPanView
  onViewChange?: (view: ZoomPanView) => void
  /** Off: no buttons in the corner (one of a linked pair shows them for both). */
  controls?: boolean
  /** Off: the picture stays fitted and takes no wheel or drag. */
  enabled?: boolean
  className?: string
  /** Over the viewport's corners, outside the zoom: controls that must stay put. */
  overlay?: ReactNode
}

/** Pixels a press may move and still be a click on what is under it. */
const DRAG_SLOP_PX = 4
const STEP = 1.5

export function ZoomPan({
  children,
  label = 'picture',
  maxScale = 8,
  resetKey = null,
  onScaleChange,
  view: heldView,
  onViewChange,
  controls = true,
  enabled = true,
  className,
  overlay,
}: ZoomPanProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const [ownView, setOwnView] = useState<ZoomPanView>(FIT_VIEW)
  const [shownFor, setShownFor] = useState(resetKey)
  if (shownFor !== resetKey) {
    setShownFor(resetKey)
    setOwnView(FIT_VIEW)
  }
  const view = heldView ?? ownView
  // Where a new view goes: the holder that keeps it, else here.
  const commit = useRef<(next: ZoomPanView) => void>(setOwnView)
  useEffect(() => {
    commit.current = onViewChange ?? setOwnView
  }, [onViewChange])
  const [dragging, setDragging] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const press = useRef<{ x: number; y: number; view: ZoomPanView; moved: boolean; spread: number } | null>(null)
  const live = enabled ? view : FIT_VIEW

  const size = () => {
    const box = viewport.current?.getBoundingClientRect()
    return { left: box?.left ?? 0, top: box?.top ?? 0, width: box?.width ?? 0, height: box?.height ?? 0 }
  }
  // What the handlers read: the view as last committed, so a wheel can decide at once whether it is ours.
  const current = useRef(live)
  useEffect(() => {
    current.current = live
  })
  const apply = (next: ZoomPanView) => {
    const held = clampView(next, size(), maxScale)
    current.current = held
    commit.current(held)
  }

  const scale = live.scale
  const report = useRef(onScaleChange)
  useEffect(() => {
    report.current = onScaleChange
  })
  useEffect(() => {
    report.current?.(scale)
  }, [scale])

  // The wheel is taken through a listener of its own: React's is passive, so its `preventDefault` is ignored and the
  // page would scroll under a zoom.
  useEffect(() => {
    const element = viewport.current
    if (!element || !enabled) return
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element | null)?.closest?.('[data-zoom-pan-ignore]')) return
      // A pinch on a trackpad arrives as a wheel with Ctrl held, in finer steps than a wheel's notches.
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015))
      const from = current.current
      // Zooming out of a fitted picture is the page's scroll, not ours.
      if (factor <= 1 && from.scale <= 1) return
      event.preventDefault()
      const box = element.getBoundingClientRect()
      const next = clampView(
        zoomAbout(from, from.scale * factor, { x: event.clientX - box.left, y: event.clientY - box.top }, maxScale),
        box,
        maxScale,
      )
      current.current = next
      commit.current(next)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [enabled, maxScale])

  const spreadOf = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  const middleOf = () => {
    const points = [...pointers.current.values()]
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    }
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0) return
    if ((event.target as Element).closest('[data-zoom-pan-ignore], button, a, input, [role="dialog"]')) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const middle = middleOf()
    press.current = { ...middle, view: live, moved: false, spread: spreadOf() }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = press.current
    if (!start || !pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const middle = middleOf()
    const dx = middle.x - start.x,
      dy = middle.y - start.y
    const pinching = pointers.current.size > 1
    if (!start.moved) {
      // A fitted picture has nowhere to go under one finger: that press stays a click on what is under it.
      const panned = Math.hypot(dx, dy) >= DRAG_SLOP_PX && (pinching || start.view.scale > 1)
      const pinched = pinching && Math.abs(spreadOf() - start.spread) >= DRAG_SLOP_PX
      if (!panned && !pinched) return
      start.moved = true
      setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const box = size()
    const moved = { ...start.view, x: start.view.x + dx, y: start.view.y + dy }
    apply(
      pinching && start.spread > 0
        ? zoomAbout(
            moved,
            start.view.scale * (spreadOf() / start.spread),
            { x: middle.x - box.left, y: middle.y - box.top },
            maxScale,
          )
        : moved,
    )
  }
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return
    const start = press.current
    if (pointers.current.size) {
      // One finger of a pinch lifted: the other carries on from where the picture stands.
      const middle = middleOf()
      press.current = { ...middle, view: live, moved: start?.moved ?? false, spread: 0 }
      return
    }
    press.current = null
    setDragging(false)
    if (!start?.moved) return
    // The click that ends a drag is the drag's, not a click on the picture under it.
    const swallow = (click: MouseEvent) => {
      click.stopPropagation()
      click.preventDefault()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
  }

  const step = (factor: number) => {
    const box = size()
    const from = current.current
    apply(zoomAbout(from, from.scale * factor, { x: box.width / 2, y: box.height / 2 }, maxScale))
  }
  const zoomed = live.scale > 1.001
  const buttonClass =
    'flex h-7 w-7 items-center justify-center rounded-sm text-foreground hover:bg-foreground/[0.08] disabled:text-muted-foreground disabled:hover:bg-transparent touch:h-10 touch:w-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div
      ref={viewport}
      className={cn('relative overflow-hidden', zoomed && 'touch-none', className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      data-zoom-pan-scale={live.scale.toFixed(2)}
    >
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center',
          zoomed && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
        )}
        style={
          {
            transform: `translate(${live.x}px, ${live.y}px) scale(${live.scale})`,
            transformOrigin: '0 0',
            '--zoom-pan-scale': live.scale,
          } as CSSProperties
        }
      >
        {children}
      </div>
      {overlay}
      {enabled && controls && (
        <div
          className="absolute bottom-2 right-2 z-10 flex items-center rounded-md border border-border bg-background/90 p-0.5 text-2xs shadow-sm backdrop-blur"
          role="group"
          aria-label={`Zoom the ${label}`}
          data-zoom-pan-ignore
        >
          <button
            type="button"
            className={buttonClass}
            aria-label={`Zoom out of the ${label}`}
            disabled={!zoomed}
            onClick={() => step(1 / STEP)}
          >
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="min-w-10 text-center tabular-nums text-muted-foreground" role="status">
            {Math.round(live.scale * 100)}%
          </span>
          <button
            type="button"
            className={buttonClass}
            aria-label={`Zoom in on the ${label}`}
            disabled={live.scale >= maxScale - 0.001}
            onClick={() => step(STEP)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className={buttonClass}
            aria-label={`Fit the ${label}`}
            disabled={!zoomed}
            onClick={() => apply(FIT_VIEW)}
          >
            <Maximize className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
