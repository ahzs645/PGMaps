import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { ResizeSeparator } from './resizable-split'
import { setPaneResizing } from './pane-resize'
import { readStoredSizes, writeStoredSizes } from './pane-sizes'

export interface MetricSummaryResizeOptions {
  storageKey: string
  label: string
  /** The summary's measurements element, controlled by the separator. */
  controls: string
}

/** Resizes the preceding summary without putting pointer movements through its workspace's state. */
export function MetricSummaryResize({ storageKey, label, controls }: MetricSummaryResizeOptions) {
  const handle = useRef<HTMLDivElement>(null)
  const token = useRef(Symbol('metric-summary-resize'))
  const drag = useRef<{ pointer: number; x: number; width: number; previous: string } | null>(null)

  const panel = useCallback(() => {
    return handle.current!.previousElementSibling as HTMLElement
  }, [])
  const bounds = useCallback(() => {
    const available = handle.current!.parentElement!.getBoundingClientRect().width
    const max = Math.min(360, available * 0.4)
    return { min: Math.min(128, max), max }
  }, [])
  const describe = useCallback(() => {
    const { min, max } = bounds()
    handle.current!.setAttribute('aria-valuemin', String(Math.round(min)))
    handle.current!.setAttribute('aria-valuemax', String(Math.round(max)))
    handle.current!.setAttribute('aria-valuenow', String(Math.round(panel().getBoundingClientRect().width)))
  }, [bounds, panel])
  const sizeTo = useCallback(
    (width: number) => {
      const { min, max } = bounds()
      panel().style.setProperty('--metric-summary-width', `${Math.min(max, Math.max(min, width))}px`)
      describe()
    },
    [bounds, panel, describe],
  )
  function save() {
    writeStoredSizes(storageKey, [panel().getBoundingClientRect().width])
  }
  function reset() {
    panel().style.removeProperty('--metric-summary-width')
    writeStoredSizes(storageKey, null)
    describe()
  }
  useLayoutEffect(() => {
    const summary = panel()
    const grip = handle.current!
    const resizeToken = token.current
    const stored = readStoredSizes(storageKey, 1)?.[0]
    if (stored && Number.isFinite(stored)) sizeTo(stored)
    else describe()
    const observer = new ResizeObserver(describe)
    observer.observe(summary)
    observer.observe(grip.parentElement!)
    return () => {
      observer.disconnect()
      drag.current = null
      delete grip.dataset.dragging
      setPaneResizing(resizeToken, false)
      summary.style.removeProperty('--metric-summary-width')
    }
  }, [storageKey, panel, sizeTo, describe])

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      width: panel().getBoundingClientRect().width,
      previous: panel().style.getPropertyValue('--metric-summary-width'),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.dragging = 'true'
    setPaneResizing(token.current, true)
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || start.pointer !== event.pointerId) return
    sizeTo(start.width + event.clientX - start.x)
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start || start.pointer !== event.pointerId) return
    if (event.type === 'pointerup') {
      move(event)
      if (event.clientX !== start.x) save()
    } else {
      if (start.previous) panel().style.setProperty('--metric-summary-width', start.previous)
      else panel().style.removeProperty('--metric-summary-width')
      describe()
    }
    drag.current = null
    delete event.currentTarget.dataset.dragging
    setPaneResizing(token.current, false)
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    const delta = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 64 : 16)
    sizeTo(panel().getBoundingClientRect().width + delta)
    save()
  }
  return (
    <ResizeSeparator
      ref={handle}
      orientation="vertical"
      className="metric-summary-resize select-none"
      aria-label={`Resize ${label} and connected views`}
      aria-controls={controls}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={keyboard}
      onDoubleClick={reset}
    />
  )
}
