import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

/** Full-size media reveal: dragging changes only clipping, never either map's viewport. */
export function MapSwipe({
  left,
  right,
  leftLabel,
  rightLabel,
  onPositionChange,
  testId = 'map-swipe',
}: {
  left: ReactNode
  right: ReactNode
  leftLabel: string
  rightLabel: string
  onPositionChange?: (percent: number) => void
  testId?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const slider = useRef<HTMLDivElement>(null)
  const position = useRef(50)
  const pending = useRef(50)
  const frame = useRef(0)
  const drag = useRef<{ id: number; left: number; width: number; offset: number } | null>(null)
  const labels = useRef({ leftLabel, rightLabel, onPositionChange })
  useLayoutEffect(() => {
    labels.current = { leftLabel, rightLabel, onPositionChange }
  }, [leftLabel, rightLabel, onPositionChange])
  const apply = useCallback(() => {
    frame.current = 0
    const percent = pending.current
    position.current = percent
    host.current?.style.setProperty('--map-swipe-position', `${percent}%`)
    slider.current?.setAttribute('aria-valuenow', String(Math.round(percent)))
    slider.current?.setAttribute(
      'aria-valuetext',
      `${Math.round(percent)}% ${labels.current.leftLabel}, ${Math.round(100 - percent)}% ${labels.current.rightLabel}`,
    )
    labels.current.onPositionChange?.(percent)
  }, [])
  const schedule = (percent: number) => {
    pending.current = Math.max(0, Math.min(100, percent))
    if (!frame.current) frame.current = requestAnimationFrame(apply)
  }
  useEffect(() => {
    apply()
    return () => cancelAnimationFrame(frame.current)
  }, [apply, leftLabel, rightLabel])
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || !host.current) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = host.current.getBoundingClientRect()
    drag.current = {
      id: event.pointerId,
      left: bounds.left,
      width: bounds.width,
      offset: event.clientX - bounds.left - (position.current * bounds.width) / 100,
    }
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId || !current.width) return
    event.preventDefault()
    schedule(((event.clientX - current.left - current.offset) / current.width) * 100)
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return
    drag.current = null
    cancelAnimationFrame(frame.current)
    apply()
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1
    const values: Record<string, number> = {
      Home: 0,
      End: 100,
      ArrowLeft: pending.current - step,
      ArrowDown: pending.current - step,
      ArrowRight: pending.current + step,
      ArrowUp: pending.current + step,
      PageDown: pending.current - 10,
      PageUp: pending.current + 10,
    }
    if (!(event.key in values)) return
    event.preventDefault()
    event.stopPropagation()
    schedule(values[event.key])
  }
  return (
    <div ref={host} data-testid={testId} className="relative h-full w-full">
      {left}
      <div
        data-testid={`${testId}-right`}
        className="pointer-events-none absolute inset-0"
        style={{ clipPath: 'inset(0 0 0 var(--map-swipe-position, 50%))' }}
      >
        {right}
      </div>
      <div
        ref={slider}
        role="slider"
        tabIndex={0}
        aria-label={`Compare ${leftLabel} and ${rightLabel}`}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={50}
        aria-valuetext={`50% ${leftLabel}, 50% ${rightLabel}`}
        data-testid={`${testId}-slider`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onKeyDown={key}
        onClick={(event) => event.stopPropagation()}
        className="group absolute inset-y-0 z-[3] w-11 -translate-x-1/2 cursor-ew-resize touch-none select-none outline-none"
        style={{ left: 'var(--map-swipe-position, 50%)' }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white shadow-[0_0_2px_#0008]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[2px] border border-[#6e6e6e80] bg-white text-xl text-[#333] shadow-sm group-focus-visible:ring-2 group-focus-visible:ring-sky-400"
        >
          ↔
        </span>
      </div>
    </div>
  )
}
