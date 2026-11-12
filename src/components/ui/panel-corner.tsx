import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { setPaneResizing } from './pane-resize'
import { readStoredSizes, writeStoredSizes } from './pane-sizes'
import './panel-corner.css'

const wideGuide = '(min-width: 900px), (min-width: 560px) and (max-height: 599px)'
const hint = 'Drag to resize or use the arrow keys. Double-click or press Enter to restore the default size.'

/** The grip sits inside the existing panel so its map, forms and fullscreen state stay mounted. */
export function PanelCorner({
  storageKey,
  label,
  viewport = false,
}: {
  storageKey: string
  label: string
  viewport?: boolean
}) {
  const wide = useMediaQuery(wideGuide)
  const key = `${storageKey}:${viewport ? 'sheet' : wide ? 'wide' : 'compact'}`
  const handle = useRef<HTMLButtonElement>(null)
  const token = useRef(Symbol('panel-corner'))
  const drag = useRef<{
    pointer: number
    x: number
    y: number
    width: number
    height: number
    moved: boolean
  } | null>(null)

  function apply(panel: HTMLElement, fractions: number[] | null) {
    for (const [index, axis] of ['width', 'height'].entries()) {
      if (fractions) panel.style.setProperty(`--corner-${axis}`, `${Math.min(1, fractions[index]) * 100}%`)
      else panel.style.removeProperty(`--corner-${axis}`)
    }
  }
  useLayoutEffect(() => {
    const panel = handle.current!.parentElement!
    const resizeToken = token.current
    apply(panel, readStoredSizes(key, 2))
    return () => {
      drag.current = null
      setPaneResizing(resizeToken, false)
      apply(panel, null)
    }
  }, [key])

  function available(panel: HTMLElement) {
    return viewport
      ? { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
      : panel.parentElement!.getBoundingClientRect()
  }
  function sizeTo(panel: HTMLElement, width: number, height: number) {
    const slot = available(panel)
    if (slot.width && slot.height) apply(panel, [Math.max(1, width) / slot.width, Math.max(1, height) / slot.height])
  }
  function save(panel: HTMLElement) {
    const rect = panel.getBoundingClientRect()
    const slot = available(panel)
    if (!slot.width || !slot.height) return
    const fractions = [rect.width / slot.width, rect.height / slot.height]
    apply(panel, fractions)
    writeStoredSizes(key, fractions)
  }
  function reset() {
    apply(handle.current!.parentElement!, null)
    writeStoredSizes(key, null)
  }
  function begin(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    const rect = event.currentTarget.parentElement!.getBoundingClientRect()
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setPaneResizing(token.current, true)
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current
    if (!start || start.pointer !== event.pointerId) return
    if (!start.moved && event.clientX === start.x && event.clientY === start.y) return
    start.moved = true
    sizeTo(
      event.currentTarget.parentElement!,
      start.width + event.clientX - start.x,
      start.height + event.clientY - start.y,
    )
  }
  function end(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointer !== event.pointerId) return
    const panel = event.currentTarget.parentElement!
    if (event.type === 'pointerup') {
      move(event)
      if (drag.current.moved) save(panel)
    } else {
      apply(panel, readStoredSizes(key, 2))
    }
    drag.current = null
    setPaneResizing(token.current, false)
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const step = steps[event.key]
    if (!step) return
    event.preventDefault()
    event.stopPropagation()
    const panel = event.currentTarget.parentElement!
    const rect = panel.getBoundingClientRect()
    const increment = event.shiftKey ? 48 : 16
    sizeTo(panel, rect.width + step[0] * increment, rect.height + step[1] * increment)
    save(panel)
  }
  return (
    <button
      type="button"
      ref={handle}
      className="lp-panel-grip"
      aria-label={`Resize ${label}`}
      title={hint}
      aria-description={hint}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={keyboard}
      onDoubleClick={reset}
      onClick={(event) => {
        if (event.detail === 0) reset()
      }}
    />
  )
}
